"""
Group Optimization Service

Extends the trip optimization pipeline to support group trips with
multiple traveler profiles. Maps TravelerProfile, TravelerLoyaltyBalance,
and TravelerContributionPreference into optimizer inputs.

Two-stage optimization:
  Stage A: Search flights per-traveler (different origins → same destination)
  Stage B: Run group ILP solver to allocate points across travelers
"""

import re
import uuid
import asyncio
import logging
from datetime import date, datetime
from dataclasses import asdict
from typing import Dict, Any, List, Optional, Tuple

from fastapi import HTTPException

from src.repos import group_planning_repo as repo
from src.services import group_planning_service as gps
from src.services.group_connection_protection import derive_protection, is_bag_safe
from src.services.settlement_engine import (
    value_points, ValuationMode, DEFAULT_MARKET_CPP,
)
from src.handlers.group_oop_optimizer import (
    GroupMember,
    GroupPointsPool,
    MemberBookingItem,
    GroupPointsOption,
    GroupOOPSolution,
    GroupPaymentAllocation,
    GroupTransferInstruction,
    SettlementEntry,
    MemberRole,
    PaymentType,
    SolveMode,
    minimize_group_out_of_pocket_two_phase,
    group_solution_to_dict,
    normalize_program_code,
)
from src.handlers.group_points_pooling import aggregate_group_points
from src.optimization.arrival_coordination import (
    build_flight_choices,
    coordinate_arrivals,
    DEFAULT_WINDOW_MINUTES,
)
from src.optimization.pooling_constraints import PoolingScope

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
            "return_airport": t.get("returnAirport"),
            "checks_bags": bool(t.get("checksBags", False)),
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
        # Ordered multi-city itinerary (None for single-destination trips).
        "legs": trip.get("legs"),
        "split_method": trip.get("splitMethod", "points_value_weighted"),
        "travelers": traveler_inputs,
        # Arrival coordination config (None => auto: on when 2+ distinct origins).
        "coordinate_arrival": trip.get("coordinateArrival"),
        "arrival_window_minutes": trip.get("arrivalWindowMinutes"),
        "shared_constraints": {
            "same_flight_preferred": True,
            "same_hotel_required": False,
        },
    }


async def optimize_group_trip(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """
    Full group optimization:
      Stage A: Search flights per-traveler (different origins → same destination)
      Stage B: Run ILP solver to allocate points across travelers
      Stage C: Persist assignments and ledger entries
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

    # Include pooling scope from trip config
    inputs["pooling_scope"] = trip.get("poolingScope", "full_group")

    # Update status
    trip["status"] = "optimizing"
    repo.put_group_trip(trip)

    try:
        result = await _run_staged_optimization(inputs)

        # Persist optimization results (assignments + ledger)
        _persist_optimization_results(group_trip_id, result, travelers)

        # Hotel recommendations (only when includeHotels is true)
        hotel_recs_payload = None
        if trip.get("includeHotels", False):
            try:
                from src.services.hotel_recommendation_service import recommend_hotels_for_group_trip

                # Total group cash budget: sum of each traveler's cash envelope.
                # Treat missing/None as uncapped for that traveler.
                total_cash_budget = 0.0
                any_capped = False
                for t in travelers:
                    cb = t.get("cashBudget")
                    if cb is not None:
                        total_cash_budget += float(cb)
                        any_capped = True
                group_cash_budget = total_cash_budget if any_capped else None

                # Flight OOP already spent: sum cash on flight allocations.
                flight_oop = 0.0
                for alloc in (result.get("allocations") or []):
                    if "hotel" not in (alloc.get("item_id") or ""):
                        flight_oop += float(alloc.get("cash_paid") or 0)

                cash_budget_remaining = (
                    max(0.0, group_cash_budget - flight_oop)
                    if group_cash_budget is not None else None
                )

                # Aggregate hotel-program points across all travelers.
                # (Airline miles are irrelevant for hotel booking.)
                pooled_hotel_points: Dict[str, int] = {}
                hotel_codes = {"MAR", "HH", "HYATT", "IHG"}
                for tr in (inputs.get("travelers") or []):
                    for program, balance in (tr.get("points") or {}).items():
                        if not balance:
                            continue
                        code = program.upper() if program else ""
                        if code in hotel_codes or program in hotel_codes:
                            pooled_hotel_points[code or program] = (
                                pooled_hotel_points.get(code or program, 0) + int(balance)
                            )

                logger.info(
                    f"Group hotel budget envelope: "
                    f"${cash_budget_remaining if cash_budget_remaining is not None else 'unlimited'} "
                    f"(total ${group_cash_budget or 'unset'} - flights ${flight_oop:.2f}); "
                    f"pooled hotel points: {pooled_hotel_points or 'none'}"
                )

                hotel_recs = recommend_hotels_for_group_trip(
                    destination=trip.get("destination", ""),
                    start_date=trip.get("startDate", ""),
                    end_date=trip.get("endDate", ""),
                    traveler_count=len(travelers),
                    cash_budget_remaining=cash_budget_remaining,
                    user_points=pooled_hotel_points or None,
                )
                hotel_recs_payload = [r.model_dump() for r in hotel_recs]
                logger.info(f"Generated {len(hotel_recs)} hotel recommendations for group trip {group_trip_id}")
            except Exception as hotel_err:
                logger.warning(f"Hotel recommendations failed for group trip (non-fatal): {hotel_err}")

        trip["status"] = "ready"
        # Distinguish "optimized successfully" from "ran but found no flights" so
        # the results UI can show an explicit empty state instead of a silently
        # missing flights section.
        trip["optimizationStatus"] = (
            "no_flights" if result.get("status") == "no_flights" else "ready"
        )
        if hotel_recs_payload is not None:
            trip["hotelRecommendations"] = hotel_recs_payload
        # Persist the arrival-coordination summary so a later GET can render the
        # staggered per-traveler schedule (assignments alone don't carry times).
        if result.get("arrival_coordination") is not None:
            trip["arrivalCoordination"] = result["arrival_coordination"]
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


def _persist_optimization_results(
    group_trip_id: str,
    result: Dict[str, Any],
    travelers: List[Dict[str, Any]],
) -> None:
    """
    Persist ILP optimization results as assignments and ledger entries in DynamoDB.

    Bridges the GroupOOPSolution dict output into the persisted format used by
    the settlement calculator and frontend.
    """
    now = datetime.utcnow().isoformat() + "Z"
    allocations = result.get("allocations", [])
    transfers = result.get("transfers", [])

    # Cabin per traveler, so each flight assignment can surface the booked cabin.
    cabin_by_traveler = {
        t.get("travelerId", ""): t.get("cabinPreference") for t in travelers
    }

    for alloc in allocations:
        assignment_id = str(uuid.uuid4())
        item_type = "flight"
        if "hotel" in (alloc.get("item_id") or ""):
            item_type = "hotel"

        cash_cost = float(alloc.get("cash_paid", 0))
        points_cost = int(alloc.get("points_used") or 0)
        points_program = alloc.get("program_used")
        points_value = float(alloc.get("points_value_usd") or 0)
        traveler_id = alloc.get("beneficiary_member", "")

        # Persist assignment
        assignment_item = {
            "assignmentId": assignment_id,
            "groupTripId": group_trip_id,
            "itineraryItemId": alloc.get("item_id", ""),
            "travelerProfileId": traveler_id,
            "itemType": item_type,
            "sharedGroupKey": None,
            "cashCost": cash_cost,
            "pointsCost": points_cost,
            "pointsProgram": points_program,
            "imputedPointsValueUsd": points_value,
            "pointsOwnerId": alloc.get("points_owner"),
            "connection": alloc.get("connection"),
            "flightDetails": alloc.get("flight_details"),
            "cabin": cabin_by_traveler.get(traveler_id) if item_type == "flight" else None,
            "legIndex": alloc.get("leg_index"),
            "legLabel": alloc.get("leg_label"),
            "createdAt": now,
        }
        repo.put_itinerary_assignment(group_trip_id, assignment_item)

        # Persist ledger entries
        payment_type = alloc.get("payment_type", "cash")
        if payment_type == "points" and points_cost > 0:
            points_owner = alloc.get("points_owner", traveler_id)
            ledger_entry = {
                "entryId": str(uuid.uuid4()),
                "groupTripId": group_trip_id,
                "travelerProfileId": points_owner,
                "entryType": "points_used",
                "referenceType": item_type,
                "referenceId": assignment_id,
                "amountUsd": points_value,
                "pointsAmount": points_cost,
                "pointsProgram": points_program,
                "description": f"Points used for {traveler_id}'s {item_type}",
                "createdAt": now,
            }
            repo.put_ledger_entry(group_trip_id, ledger_entry)

            # Surcharge (taxes/fees paid in cash)
            if cash_cost > 0:
                surcharge_entry = {
                    "entryId": str(uuid.uuid4()),
                    "groupTripId": group_trip_id,
                    "travelerProfileId": traveler_id,
                    "entryType": "tax_paid",
                    "referenceType": item_type,
                    "referenceId": assignment_id,
                    "amountUsd": cash_cost,
                    "pointsAmount": None,
                    "pointsProgram": None,
                    "description": f"Taxes/fees for {item_type}",
                    "createdAt": now,
                }
                repo.put_ledger_entry(group_trip_id, surcharge_entry)
        else:
            # Cash payment
            if cash_cost > 0:
                cash_entry = {
                    "entryId": str(uuid.uuid4()),
                    "groupTripId": group_trip_id,
                    "travelerProfileId": traveler_id,
                    "entryType": "cash_paid",
                    "referenceType": item_type,
                    "referenceId": assignment_id,
                    "amountUsd": cash_cost,
                    "pointsAmount": None,
                    "pointsProgram": None,
                    "description": f"Cash payment for {item_type}",
                    "createdAt": now,
                }
                repo.put_ledger_entry(group_trip_id, cash_entry)

    logger.info(f"Persisted {len(allocations)} assignments and ledger entries for group trip {group_trip_id}")


def get_pool_summary(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """Get a summary of the group's aggregated points pool."""
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can view pool.")

    inputs = _build_group_optimization_inputs(group_trip_id)
    pooling_scope = trip.get("poolingScope", "full_group")
    group_members = _build_group_members(inputs["travelers"], pooling_scope)
    pool = aggregate_group_points(group_members)

    from src.handlers.group_points_pooling import get_pool_summary as _get_summary
    return _get_summary(pool, group_members)


def get_transfer_instructions(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """Get transfer instructions from the latest optimization result."""
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can view transfer instructions.")

    assignments = repo.get_assignments_for_trip(group_trip_id)
    travelers = repo.get_travelers_for_trip(group_trip_id)
    traveler_lookup = {t["travelerId"]: t.get("displayName", "") for t in travelers}

    # Build transfer instructions from assignments that used points from a different owner
    instructions = []
    order = 1
    for a in assignments:
        points_owner = a.get("pointsOwnerId")
        traveler_id = a.get("travelerProfileId", "")
        if points_owner and points_owner != traveler_id and a.get("pointsProgram"):
            instructions.append({
                "order": order,
                "points_owner": points_owner,
                "points_owner_name": traveler_lookup.get(points_owner, points_owner),
                "beneficiary": traveler_id,
                "beneficiary_name": traveler_lookup.get(traveler_id, traveler_id),
                "program": a.get("pointsProgram"),
                "points": a.get("pointsCost", 0),
                "value_usd": float(a.get("imputedPointsValueUsd") or 0),
                "item_type": a.get("itemType", "flight"),
                "item_id": a.get("itineraryItemId", ""),
            })
            order += 1

    return {
        "group_trip_id": group_trip_id,
        "transfer_count": len(instructions),
        "instructions": instructions,
    }


def get_booking_checklist(group_trip_id: str, user_id: str) -> Dict[str, Any]:
    """Get a booking checklist summarizing what each traveler needs to do."""
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can view checklist.")

    travelers = repo.get_travelers_for_trip(group_trip_id)
    assignments = repo.get_assignments_for_trip(group_trip_id)
    settlements = repo.get_settlements_for_trip(group_trip_id)
    traveler_lookup = {t["travelerId"]: t.get("displayName", "") for t in travelers}

    checklist_by_traveler = {}
    for t in travelers:
        tid = t["travelerId"]
        name = t.get("displayName", "Traveler")
        traveler_assignments = [a for a in assignments if a.get("travelerProfileId") == tid]
        traveler_settlements = [s for s in settlements if s.get("travelerProfileId") == tid]

        tasks = []
        # Transfer tasks (where this traveler needs to transfer points for someone else)
        for a in assignments:
            if a.get("pointsOwnerId") == tid and a.get("travelerProfileId") != tid:
                beneficiary_name = traveler_lookup.get(a.get("travelerProfileId", ""), "")
                tasks.append({
                    "type": "transfer_points",
                    "description": f"Transfer {a.get('pointsCost', 0):,} {a.get('pointsProgram', '')} points for {beneficiary_name}'s {a.get('itemType', 'flight')}",
                    "status": "pending",
                })

        # Booking tasks
        for a in traveler_assignments:
            payment = "cash" if not a.get("pointsProgram") else f"{a.get('pointsCost', 0):,} {a.get('pointsProgram', '')} points"
            tasks.append({
                "type": "book",
                "description": f"Book {a.get('itemType', 'flight')} using {payment}",
                "status": "pending",
            })

        # Settlement tasks
        for s in traveler_settlements:
            net_owed = float(s.get("netOwedUsd", 0))
            if net_owed > 0:
                tasks.append({
                    "type": "settle",
                    "description": f"Pay ${net_owed:.2f} to settle group costs",
                    "status": "pending",
                })

        checklist_by_traveler[tid] = {
            "traveler_name": name,
            "task_count": len(tasks),
            "tasks": tasks,
        }

    return {
        "group_trip_id": group_trip_id,
        "trip_status": trip.get("status", "draft"),
        "checklist": checklist_by_traveler,
    }


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
        "optimization_status": trip.get("optimizationStatus"),
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
    arrival_coord = trip.get("arrivalCoordination")
    if arrival_coord:
        out["arrival_coordination"] = arrival_coord
    return out


def _parse_airports(value: Optional[str]) -> List[str]:
    """Split a stored airport value into candidate IATA codes.

    A traveler may pick a single airport ("JFK") or a whole city, which the
    frontend sends as a comma-separated list ("EWR,JFK,LGA"). Returns de-duped,
    upper-cased codes preserving order.
    """
    if not value:
        return []
    seen = set()
    codes: List[str] = []
    for part in str(value).split(","):
        code = part.strip().upper()
        if code and code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def _parse_destination_airports(value: Optional[str]) -> List[str]:
    """Extract destination IATA code(s) from a trip's destination label.

    Unlike traveler origins (stored as bare codes), the destination is stored
    as the city-autocomplete display label, e.g. "Paris (Val-d'Oise) (CDG)" or
    "Paris (CDG,ORY)". The IATA code(s) live in the final parenthesized group;
    any earlier group is a region name. Flight search needs the bare code(s), so
    pull them from that last group, falling back to the raw value when it is
    already a code. (Multi-city destinations only resolve the last city here.)
    """
    if not value:
        return []
    groups = re.findall(r"\(([^)]+)\)", value)
    raw = groups[-1] if groups else value
    seen = set()
    codes: List[str] = []
    for part in raw.split(","):
        code = part.strip().upper()
        if re.fullmatch(r"[A-Z]{3}", code) and code not in seen:
            seen.add(code)
            codes.append(code)
    return codes


def _parse_itinerary(inputs: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Resolve a trip's ordered destination legs for flight search.

    Returns one entry per destination city the group flies INTO, ordered:
        [{airports: ["CDG"], date: "2026-08-11", label: "Paris (CDG)"}, ...]
    where ``date`` is when the group departs the PREVIOUS stop to reach this city
    (so the first leg's date is the trip's start_date). The return leg is handled
    separately by the caller (last city -> each traveler's return airport).

    When the trip has structured ``legs`` they are used directly; otherwise a
    single implicit leg is derived from ``destination`` + ``start_date`` so legacy
    single-destination trips behave exactly as before.
    """
    legs = inputs.get("legs")
    if legs:
        itinerary: List[Dict[str, Any]] = []
        for leg in legs:
            airports = _parse_airports(leg.get("airports"))
            if not airports:
                continue
            itinerary.append({
                "airports": airports,
                "date": leg.get("depart_date") or inputs.get("start_date", ""),
                "label": leg.get("city_label") or ",".join(airports),
            })
        if itinerary:
            return itinerary

    # Legacy single-destination fallback. Labelled "Outbound" so a simple round
    # trip renders as Outbound / Return rather than echoing the verbose label.
    destination = inputs.get("destination", "")
    codes = _parse_destination_airports(destination) or [destination]
    return [{
        "airports": codes,
        "date": inputs.get("start_date", ""),
        "label": "Outbound",
    }]


async def _search_one_route(
    traveler: Dict[str, Any],
    origin: str,
    destination: str,
    search_date: date,
    cabin,
) -> List[Dict[str, Any]]:
    """Search a single origin→destination route; returns option dicts, each
    tagged with the specific origin/destination it came from."""
    from src.handlers.solo_trip.flight_searcher import ComprehensiveFlightSearcher

    searcher = ComprehensiveFlightSearcher()
    date_iso = search_date.isoformat()
    try:
        result = await searcher.search_all_options(
            origin=origin,
            destination=destination,
            search_date=search_date,
            cabin_class=cabin,
            user_points=traveler.get("points", {}),
            num_adults=1,
        )
    except Exception as e:
        logger.warning(f"Flight search failed for traveler {traveler['traveler_id']} ({origin}→{destination}): {e}")
        return []

    options = []
    for flight in result.options:
        # Departure local time (HH:MM) + total duration let the coordination
        # stage derive an absolute UTC arrival instant for this flight.
        legs = getattr(flight, "legs", None) or []
        dep_local = legs[0].departure_time if legs else getattr(flight, "departure_time", None)
        duration_min = (
            getattr(flight, "total_duration_minutes", 0)
            or getattr(flight, "flight_time_minutes", 0)
            or 0
        )
        opt = {
            "flight_id": getattr(flight, "option_id", None) or str(uuid.uuid4()),
            "origin": origin,
            "destination": destination,
            "date": date_iso,
            "departure_time": dep_local,            # HH:MM, origin-local
            "duration_minutes": int(duration_min) if duration_min else 0,
            "airline": getattr(flight, "marketing_airline", None),
            "description": getattr(flight, "summary", f"{origin}→{destination}"),
            "cash_cost": float(getattr(flight, "cash_price", 0) or 0),
            "points_options": [],
        }
        for award in getattr(flight, "award_options", []) or []:
            program = getattr(award, "program", None) or getattr(award, "program_code", "")
            points_req = int(getattr(award, "points_required", 0) or getattr(award, "miles", 0) or 0)
            surcharge = float(getattr(award, "surcharge", 0) or getattr(award, "taxes_fees", 0) or 0)
            if program and points_req > 0:
                opt["points_options"].append({
                    "program_code": normalize_program_code(program),
                    "points_required": points_req,
                    "surcharge": surcharge,
                })

        # Carry the connection profile so downstream stages can warn about (or
        # filter out) self-transfers where checked bags won't through-check.
        opt["connection"] = _summarize_connection(flight)

        if opt["cash_cost"] > 0 or opt["points_options"]:
            options.append(opt)
    return options


def _summarize_connection(flight) -> Dict[str, Any]:
    """Flatten a flight option's per-leg/layover detail into a serializable
    connection summary. ``has_self_transfer`` is True when any layover changes
    airline (a likely separate-ticket / bag re-check, unless interline)."""
    legs = getattr(flight, "legs", None) or []
    layovers_raw = getattr(flight, "layovers", None) or []
    layovers = []
    for i, lo in enumerate(layovers_raw):
        # Layover i sits between leg i and leg i+1, so the connecting carriers are
        # those two legs' airline codes.
        from_air = getattr(legs[i], "airline_code", None) if i < len(legs) else None
        to_air = getattr(legs[i + 1], "airline_code", None) if i + 1 < len(legs) else None
        layovers.append({
            "airport": getattr(lo, "airport", None),
            "duration_minutes": int(getattr(lo, "duration_minutes", 0) or 0),
            "airline_change": bool(getattr(lo, "airline_change", False)),
            "terminal_change": bool(getattr(lo, "terminal_change", False)),
            "from_airline": from_air,
            "to_airline": to_air,
        })
    airlines = [getattr(l, "airline_code", None) for l in legs if getattr(l, "airline_code", None)]
    num_stops = getattr(flight, "num_stops", None)
    if num_stops is None:
        num_stops = max(0, len(legs) - 1)
    summary: Dict[str, Any] = {
        "num_stops": int(num_stops),
        "airlines": airlines,
        "layovers": layovers,
    }
    # Derive ticketing / self-transfer / protection + warnings from the carriers.
    summary.update(derive_protection(layovers))
    return summary


async def _search_leg(
    traveler: Dict[str, Any],
    pairs: List[tuple],
    search_date_str: str,
) -> List[Dict[str, Any]]:
    """Search every (origin, destination) pair for one leg concurrently and
    merge the results. Because each option records the specific airport it came
    from, keeping the cheapest option per leg is equivalent to trying every
    origin/return airport combination.
    """
    from src.handlers.solo_trip.models import CabinClass

    if not pairs or not search_date_str:
        return []
    try:
        search_date = date.fromisoformat(search_date_str)
    except ValueError:
        logger.warning(f"Invalid search date '{search_date_str}', skipping leg")
        return []

    cabin_map = {
        "economy": CabinClass.ECONOMY,
        "premium_economy": CabinClass.PREMIUM_ECONOMY,
        "business": CabinClass.BUSINESS,
        "first": CabinClass.FIRST,
    }
    cabin = cabin_map.get(traveler.get("cabin_preference", "economy"), CabinClass.ECONOMY)

    results = await asyncio.gather(*[
        _search_one_route(traveler, o, d, search_date, cabin) for (o, d) in pairs
    ])
    merged = [opt for route_opts in results for opt in route_opts]

    # Bag-checking travelers avoid cross-airline self-transfers (bags won't
    # through-check). Keep only bag-safe itineraries; if that would leave none,
    # fall back to all options but flag the self-transfer as unavoidable.
    if traveler.get("checks_bags") and merged:
        safe = [o for o in merged if is_bag_safe(o.get("connection"))]
        if safe:
            merged = safe
        else:
            for o in merged:
                conn = o.get("connection")
                if conn and conn.get("has_self_transfer"):
                    conn["self_transfer_unavoidable"] = True

    logger.info(
        "Found %d flight options for traveler %s across %d route(s)",
        len(merged), traveler["traveler_id"], len(pairs),
    )
    return merged


def _build_group_members(traveler_inputs: List[Dict[str, Any]], pooling_scope: str) -> List[GroupMember]:
    """Convert traveler input dicts into GroupMember dataclass instances."""
    members = []
    for t in traveler_inputs:
        # Determine willingness based on pooling scope
        if pooling_scope == "individual_only":
            willing = False
        elif pooling_scope == "sponsors_only":
            # Only sponsors can share; regular members can't
            willing = t.get("can_pay_for_others", False)
        else:
            # full_group or household_only: everyone willing by default
            willing = True

        origin_codes = _parse_airports(t.get("origin_airport"))
        members.append(GroupMember(
            user_id=t["traveler_id"],
            name=t.get("display_name", "Traveler"),
            role=MemberRole.MEMBER,
            departure_airport=origin_codes[0] if origin_codes else "",
            cabin_preference=t.get("cabin_preference", "economy"),
            points_balances=t.get("points", {}),
            max_cash_budget=t.get("max_cash_contribution") or t.get("cash_budget"),
            willing_to_share_points=willing,
            party_size=1,
        ))
    return members


def _build_booking_items(
    traveler_id: str,
    flight_options: List[Dict[str, Any]],
    pool: GroupPointsPool,
    preferred_flight: Optional[Dict[str, Any]] = None,
    *,
    leg_index: int = 0,
    leg_label: str = "",
    is_return: bool = False,
) -> List[MemberBookingItem]:
    """
    Build MemberBookingItem objects from flight search results for one traveler.

    Baseline flight is `preferred_flight` when supplied (the schedule chosen by
    the arrival-coordination stage); otherwise the cheapest cash option. Points
    options are still aggregated across the route so payment optimization keeps
    full flexibility.

    `leg_index` makes the item id unique per leg of a multi-city trip (the return
    leg is just the highest index); `leg_label`/`is_return` shape the description.
    """
    if not flight_options:
        return []

    # Schedule baseline: the coordinated flight if given, else cheapest cash.
    best_cash = preferred_flight or min(
        flight_options, key=lambda f: f.get("cash_cost", float("inf"))
    )

    # Collect all unique points options across all flights for this route
    all_points_options = []
    seen = set()
    for flight in flight_options:
        for po in flight.get("points_options", []):
            key = (po["program_code"], po["points_required"], po["surcharge"])
            if key not in seen:
                seen.add(key)
                available_from = []
                for member_id, member_points in pool.by_member.items():
                    prog = po["program_code"]
                    if member_points.get(prog, 0) >= po["points_required"]:
                        available_from.append(member_id)
                    # Also check bank transfers
                    from src.handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH
                    from src.config.programs import BANK_PROGRAMS
                    for bank in BANK_PROGRAMS:
                        bank_bal = member_points.get(bank, 0)
                        if bank_bal > 0 and bank in EXTENDED_TRANSFER_GRAPH:
                            if prog in EXTENDED_TRANSFER_GRAPH[bank]:
                                ratio = EXTENDED_TRANSFER_GRAPH[bank][prog].get("ratio", 1.0)
                                needed_bank = int(po["points_required"] / ratio) if ratio > 0 else po["points_required"]
                                if bank_bal >= needed_bank and member_id not in available_from:
                                    available_from.append(member_id)

                all_points_options.append(GroupPointsOption(
                    program_code=po["program_code"],
                    points_required=po["points_required"],
                    surcharge=po["surcharge"],
                    available_from=available_from,
                ))

    base_description = best_cash.get("description", "Flight")
    if is_return:
        description = f"Return flight — {base_description}"
    elif leg_label:
        description = f"{leg_label} — {base_description}"
    else:
        description = base_description

    # Resolve the chosen itinerary's connection profile. A coordination
    # preferred_flight payload may be trimmed, so fall back to the full option
    # by flight_id (full options always carry "connection").
    chosen_id = best_cash.get("flight_id")
    chosen_full = next(
        (f for f in flight_options if f.get("flight_id") == chosen_id), best_cash
    )
    connection = chosen_full.get("connection")

    # Schedule/route snapshot of the chosen itinerary, carried through to the
    # persisted assignment so the results UI can render this traveler's flight
    # plan (route, times, airline) regardless of whether coordination ran.
    flight_details = {
        "flight_id": chosen_full.get("flight_id"),
        "origin": best_cash.get("origin"),
        "destination": best_cash.get("destination"),
        "date": best_cash.get("date"),
        "departure_time": best_cash.get("departure_time"),
        "duration_minutes": best_cash.get("duration_minutes"),
        "airline": best_cash.get("airline"),
        "description": base_description,
    }

    item = MemberBookingItem(
        item_id=f"flight_leg{leg_index}_{traveler_id}_{best_cash.get('origin', '')}_{best_cash.get('destination', '')}",
        member_id=traveler_id,
        item_type="flight",
        description=description,
        cash_cost=best_cash["cash_cost"],
        points_options=all_points_options,
        origin=best_cash.get("origin"),
        destination=best_cash.get("destination"),
        date=best_cash.get("date"),
        airline=best_cash.get("airline"),
        connection=connection,
        flight_details=flight_details,
        party_size=1,
    )
    return [item]


async def _run_staged_optimization(inputs: Dict[str, Any]) -> Dict[str, Any]:
    """
    Stage A: Search flights per-traveler (different origins → same destination).
    Stage B: Run group ILP solver to optimally allocate points across travelers.
    """
    travelers = inputs.get("travelers", [])
    destination = inputs.get("destination", "")
    start_date = inputs.get("start_date", "")
    pooling_scope = inputs.get("pooling_scope", "full_group")

    if not travelers:
        return {"status": "error", "message": "No travelers to optimize"}

    logger.info(f"Running staged optimization for {len(travelers)} travelers to {destination}")

    # --- Stage A: Build GroupMembers and search flights per-traveler ---
    group_members = _build_group_members(travelers, pooling_scope)
    pool = aggregate_group_points(group_members)
    end_date = inputs.get("end_date", "")

    # OUTBOUND legs: resolve the ordered itinerary (origin → city_1 → … → city_N)
    # and search each leg independently for every traveler. A city that maps to
    # several airports ("EWR,JFK,LGA") gets all of them searched; the cheapest per
    # traveler/leg wins downstream. The first leg departs the traveler's own
    # origin; later legs depart the previous city (shared by the group).
    # (Destination labels like "Paris (Val-d'Oise) (CDG)" are normalized to bare
    # IATA codes inside _parse_itinerary — flight search needs codes, not labels.)
    itinerary = _parse_itinerary(inputs)
    num_legs = len(itinerary)

    search_keys: List[Tuple[str, int]] = []
    search_tasks = []
    for t in travelers:
        tid = t["traveler_id"]
        origin_codes = _parse_airports(t.get("origin_airport"))
        for k, leg in enumerate(itinerary):
            leg_origins = origin_codes if k == 0 else itinerary[k - 1]["airports"]
            if not leg_origins:
                continue
            pairs = [(o, d) for o in leg_origins for d in leg["airports"]]
            search_keys.append((tid, k))
            search_tasks.append(_search_leg(t, pairs, leg["date"]))

    search_results = await asyncio.gather(*search_tasks) if search_tasks else []
    options_by_traveler_leg: Dict[Tuple[str, int], List[Dict[str, Any]]] = dict(
        zip(search_keys, search_results)
    )

    # Coordination (next stage) only acts on leg 0 — the only leg where travelers
    # leave from distinct origins.
    leg0_options_by_traveler: Dict[str, List[Dict[str, Any]]] = {
        t["traveler_id"]: options_by_traveler_leg.get((t["traveler_id"], 0), [])
        for t in travelers
    }

    # RETURN: last city → every return airport on the end date. Each leg is
    # minimized independently, so a traveler can depart EWR and return into LGA
    # when that pairing is cheapest.
    last_leg_airports = itinerary[-1]["airports"] if itinerary else []
    return_options_by_traveler: Dict[str, List[Dict[str, Any]]] = {}
    if end_date and last_leg_airports:
        return_tids: List[str] = []
        return_tasks = []
        for t in travelers:
            return_airports = _parse_airports(t.get("return_airport"))
            if not return_airports:
                continue
            return_tids.append(t["traveler_id"])
            return_tasks.append(
                _search_leg(
                    t,
                    [(d, r) for r in return_airports for d in last_leg_airports],
                    end_date,
                )
            )
        if return_tasks:
            return_results = await asyncio.gather(*return_tasks)
            return_options_by_traveler = dict(zip(return_tids, return_results))

    # --- Stage A.5: Arrival coordination (everyone lands together) ---
    # Decide each traveler's flight (schedule). Default: coordinate when 2+
    # travelers depart from distinct origins, so e.g. NYC departs earlier than
    # Seattle to arrive in Singapore together.
    distinct_origins = {
        t.get("origin_airport") for t in travelers if t.get("origin_airport")
    }
    coordinate = inputs.get("coordinate_arrival")
    if coordinate is None:
        coordinate = len(distinct_origins) >= 2
    window_minutes = int(inputs.get("arrival_window_minutes") or DEFAULT_WINDOW_MINUTES)

    coordination_summary: Optional[Dict[str, Any]] = None
    preferred_by_traveler: Dict[str, Dict[str, Any]] = {}
    if coordinate and len(travelers) >= 2:
        choices = build_flight_choices(leg0_options_by_traveler)
        if len(choices) >= 2:
            coord = coordinate_arrivals(choices, window_minutes=window_minutes)
            preferred_by_traveler = {
                tid: c.payload for tid, c in coord.selections.items()
            }
            coordination_summary = {
                "enabled": True,
                "within_target": coord.within_target,
                "window_minutes": window_minutes,
                "spread_minutes": round(coord.spread_minutes, 1),
                "reason": coord.reason,
                "arrival_window_start_utc": (
                    coord.window_start_utc.isoformat() if coord.window_start_utc else None
                ),
                "arrival_window_end_utc": (
                    coord.window_end_utc.isoformat() if coord.window_end_utc else None
                ),
                "schedule": {
                    tid: {
                        "flight_id": c.flight_id,
                        "origin": c.payload.get("origin"),
                        "departure_local": c.payload.get("departure_time"),
                        "departure_utc": c.departure_utc.isoformat(),
                        "arrival_utc": c.arrival_utc.isoformat(),
                        "duration_minutes": c.payload.get("duration_minutes"),
                    }
                    for tid, c in coord.selections.items()
                },
            }
            logger.info(
                "Arrival coordination: within_target=%s spread=%.0fmin (%d travelers)",
                coord.within_target, coord.spread_minutes, len(coord.selections),
            )
        else:
            coordination_summary = {
                "enabled": True,
                "within_target": False,
                "reason": "insufficient_flights_with_timing_data",
                "window_minutes": window_minutes,
            }
            logger.warning("Arrival coordination skipped: <2 travelers had timing data")

    # Build booking items: one per itinerary leg (leg 0 pinned to the coordinated
    # flight when coordination ran) plus a return leg, per traveler. The solver
    # allocates points across all of them. A leg with no flights for a traveler
    # simply contributes no item, so the rest of the trip still optimizes.
    all_booking_items: List[MemberBookingItem] = []
    leg_meta_by_item: Dict[str, Dict[str, Any]] = {}

    def _track(items: List[MemberBookingItem], leg_index: int, leg_label: str) -> None:
        for it in items:
            leg_meta_by_item[it.item_id] = {"leg_index": leg_index, "leg_label": leg_label}
        all_booking_items.extend(items)

    for traveler in travelers:
        tid = traveler["traveler_id"]
        for k, leg in enumerate(itinerary):
            _track(
                _build_booking_items(
                    tid,
                    options_by_traveler_leg.get((tid, k), []),
                    pool,
                    preferred_flight=preferred_by_traveler.get(tid) if k == 0 else None,
                    leg_index=k,
                    leg_label=leg["label"],
                ),
                k,
                leg["label"],
            )
        _track(
            _build_booking_items(
                tid,
                return_options_by_traveler.get(tid, []),
                pool,
                leg_index=num_legs,
                leg_label="Return",
                is_return=True,
            ),
            num_legs,
            "Return",
        )

    if not all_booking_items:
        return {
            "status": "no_flights",
            "message": f"No flights found for any traveler to {destination}",
            "destination": destination,
            "traveler_count": len(travelers),
        }

    # --- Stage B: Run group ILP solver ---
    allow_cross = pooling_scope in ("full_group", "household_only", "sponsors_only")
    max_group_budget = sum(
        t.get("max_cash_contribution") or t.get("cash_budget") or float("inf")
        for t in travelers
    )
    if max_group_budget == float("inf"):
        max_group_budget = None

    solution, solve_meta = minimize_group_out_of_pocket_two_phase(
        members=group_members,
        booking_items=all_booking_items,
        pool=pool,
        allow_cross_member_points=allow_cross,
        max_group_budget=max_group_budget,
        balance_points_usage=True,
    )

    result = group_solution_to_dict(solution)

    # Attach each booking item's connection profile to its allocation so the
    # persisted assignment (and the results UI) can surface self-transfers.
    connection_by_item = {
        bi.item_id: bi.connection for bi in all_booking_items if getattr(bi, "connection", None)
    }
    flight_details_by_item = {
        bi.item_id: bi.flight_details
        for bi in all_booking_items
        if getattr(bi, "flight_details", None)
    }
    for alloc in result.get("allocations", []):
        conn = connection_by_item.get(alloc.get("item_id"))
        if conn:
            alloc["connection"] = conn
        details = flight_details_by_item.get(alloc.get("item_id"))
        if details:
            alloc["flight_details"] = details
        meta = leg_meta_by_item.get(alloc.get("item_id"))
        if meta:
            alloc["leg_index"] = meta["leg_index"]
            alloc["leg_label"] = meta["leg_label"]

    result["destination"] = destination
    result["traveler_count"] = len(travelers)
    result["pooling_scope"] = pooling_scope
    if coordination_summary is not None:
        result["arrival_coordination"] = coordination_summary

    if solve_meta:
        result["solve_meta"] = asdict(solve_meta) if hasattr(solve_meta, "__dataclass_fields__") else solve_meta.__dict__

    return result
