"""
Group Optimization Service

Extends the trip optimization pipeline to support group trips with
multiple traveler profiles. Maps TravelerProfile, TravelerLoyaltyBalance,
and TravelerContributionPreference into optimizer inputs.

Two-stage optimization:
  Stage A: Search flights per-traveler (different origins → same destination)
  Stage B: Run group ILP solver to allocate points across travelers
"""

import uuid
import asyncio
import logging
from datetime import date, datetime
from dataclasses import asdict
from typing import Dict, Any, List, Optional, Tuple

from fastapi import HTTPException

from src.repos import group_planning_repo as repo
from src.services import group_planning_service as gps
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


async def _search_flights_for_traveler(
    traveler: Dict[str, Any],
    destination: str,
    start_date: str,
) -> List[Dict[str, Any]]:
    """
    Search flights for a single traveler from their origin to the destination.

    Returns a list of flight option dicts with cash_cost and points_options.
    """
    from src.handlers.solo_trip.flight_searcher import ComprehensiveFlightSearcher
    from src.handlers.solo_trip.models import CabinClass

    origin = traveler.get("origin_airport")
    if not origin:
        logger.warning(f"Traveler {traveler['traveler_id']} has no origin airport, skipping flight search")
        return []

    cabin_map = {
        "economy": CabinClass.ECONOMY,
        "premium_economy": CabinClass.PREMIUM_ECONOMY,
        "business": CabinClass.BUSINESS,
        "first": CabinClass.FIRST,
    }
    cabin = cabin_map.get(traveler.get("cabin_preference", "economy"), CabinClass.ECONOMY)

    searcher = ComprehensiveFlightSearcher()
    try:
        search_date = date.fromisoformat(start_date)
        result = await searcher.search_all_options(
            origin=origin,
            destination=destination,
            search_date=search_date,
            cabin_class=cabin,
            user_points=traveler.get("points", {}),
            num_adults=1,
        )
        options = []
        for flight in result.options:
            opt = {
                "flight_id": getattr(flight, "option_id", None) or str(uuid.uuid4()),
                "origin": origin,
                "destination": destination,
                "date": start_date,
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
            if opt["cash_cost"] > 0 or opt["points_options"]:
                options.append(opt)
        logger.info(f"Found {len(options)} flight options for traveler {traveler['traveler_id']} ({origin}→{destination})")
        return options
    except Exception as e:
        logger.warning(f"Flight search failed for traveler {traveler['traveler_id']} ({origin}→{destination}): {e}")
        return []


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

        members.append(GroupMember(
            user_id=t["traveler_id"],
            name=t.get("display_name", "Traveler"),
            role=MemberRole.MEMBER,
            departure_airport=t.get("origin_airport", ""),
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
) -> List[MemberBookingItem]:
    """
    Build MemberBookingItem objects from flight search results for one traveler.

    Picks the best cash option and attaches all points options from any flight
    that could serve this route.
    """
    if not flight_options:
        return []

    # Pick the cheapest cash option as the baseline
    best_cash = min(flight_options, key=lambda f: f.get("cash_cost", float("inf")))

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

    item = MemberBookingItem(
        item_id=f"flight_{traveler_id}_{best_cash.get('origin', '')}_{best_cash.get('destination', '')}",
        member_id=traveler_id,
        item_type="flight",
        description=best_cash.get("description", "Flight"),
        cash_cost=best_cash["cash_cost"],
        points_options=all_points_options,
        origin=best_cash.get("origin"),
        destination=best_cash.get("destination"),
        date=best_cash.get("date"),
        airline=best_cash.get("airline"),
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

    # Search flights concurrently for all travelers
    search_tasks = [
        _search_flights_for_traveler(t, destination, start_date)
        for t in travelers
    ]
    search_results = await asyncio.gather(*search_tasks)

    # Build booking items from search results
    all_booking_items: List[MemberBookingItem] = []
    for traveler, flight_options in zip(travelers, search_results):
        items = _build_booking_items(traveler["traveler_id"], flight_options, pool)
        all_booking_items.extend(items)

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
    result["destination"] = destination
    result["traveler_count"] = len(travelers)
    result["pooling_scope"] = pooling_scope

    if solve_meta:
        result["solve_meta"] = asdict(solve_meta) if hasattr(solve_meta, "__dataclass_fields__") else solve_meta.__dict__

    return result
