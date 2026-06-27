"""
Group Planning Service

Business logic for organizer-managed group trip planning.
Handles CRUD for group trips, traveler profiles, loyalty balances,
and contribution preferences. Enforces ownership and validation rules.
"""

import uuid
import logging
from datetime import datetime, date
from typing import Optional, Dict, Any, List, Tuple
from fastapi import HTTPException

from src.repos import group_planning_repo as repo
from src.models.group_planning import (
    GroupTripCreate, GroupTripUpdate, GroupTripResponse,
    TravelerProfileCreate, TravelerProfileUpdate, TravelerProfileResponse,
    LoyaltyBalanceCreate, LoyaltyBalanceUpdate, LoyaltyBalanceResponse,
    ContributionPreferenceUpsert, ContributionPreferenceResponse,
    GroupTripDetailResponse,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.utcnow().isoformat() + "Z"


def _validate_dates(start_date: str, end_date: str) -> None:
    try:
        s = date.fromisoformat(start_date)
        e = date.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format. Use YYYY-MM-DD.")
    if e < s:
        raise HTTPException(status_code=400, detail="End date must be on or after start date.")


def _assert_trip_owner(trip: Dict[str, Any], user_id: str) -> None:
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can perform this action.")


def _mark_optimization_stale(trip: Dict[str, Any]) -> None:
    """Flag a previously-optimized trip as out of date after an input change
    (preferences, balances, travelers). The results page reads this flag to
    prompt a re-optimization, so an edit visibly affects the plan instead of
    silently leaving stale assignments on screen. No-op if never optimized."""
    if trip.get("optimizationStatus") or trip.get("status") == "ready":
        if not trip.get("optimizationStale"):
            trip["optimizationStale"] = True
            repo.put_group_trip(trip)


# =============================================================================
# GROUP TRIP CRUD
# =============================================================================

def create_group_trip(user_id: str, data: GroupTripCreate) -> GroupTripResponse:
    _validate_dates(data.start_date, data.end_date)
    now = _now_iso()
    trip_id = str(uuid.uuid4())

    trip_item = {
        "groupTripId": trip_id,
        "ownerUserId": user_id,
        "name": data.name,
        "destination": data.destination,
        "startDate": data.start_date,
        "endDate": data.end_date,
        "currency": data.currency,
        "status": "draft",
        "splitMethod": data.split_method.value,
        "includeHotels": data.include_hotels,
        "createdAt": now,
        "updatedAt": now,
    }
    # Persist the structured multi-city itinerary when provided. Absence means a
    # single-destination trip (the optimizer derives one implicit leg).
    if data.legs:
        trip_item["legs"] = [leg.model_dump() for leg in data.legs]
    # Only persist coordination overrides when explicitly provided; absence keeps
    # the optimizer's auto behavior (coordinate when 2+ distinct origins).
    if data.coordinate_arrival is not None:
        trip_item["coordinateArrival"] = data.coordinate_arrival
    if data.arrival_window_minutes is not None:
        trip_item["arrivalWindowMinutes"] = data.arrival_window_minutes
    repo.put_group_trip(trip_item)

    return _trip_to_response(trip_item)


def get_group_trip(group_trip_id: str, user_id: str) -> GroupTripResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    travelers = repo.get_travelers_for_trip(group_trip_id)
    return _trip_to_response(trip, traveler_count=len(travelers))


def list_group_trips(user_id: str) -> List[GroupTripResponse]:
    trips = repo.get_group_trips_by_owner(user_id)
    result = []
    for trip in trips:
        travelers = repo.get_travelers_for_trip(trip["groupTripId"])
        result.append(_trip_to_response(trip, traveler_count=len(travelers)))
    return result


def update_group_trip(group_trip_id: str, user_id: str, data: GroupTripUpdate) -> GroupTripResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    update_fields = data.model_dump(exclude_none=True)
    if not update_fields:
        raise HTTPException(status_code=400, detail="No fields to update.")

    field_mapping = {
        "name": "name",
        "destination": "destination",
        "start_date": "startDate",
        "end_date": "endDate",
        "currency": "currency",
        "status": "status",
        "split_method": "splitMethod",
        "include_hotels": "includeHotels",
    }

    for py_field, db_field in field_mapping.items():
        if py_field in update_fields:
            val = update_fields[py_field]
            trip[db_field] = val.value if hasattr(val, "value") else val

    if "startDate" in trip and "endDate" in trip:
        _validate_dates(trip["startDate"], trip["endDate"])

    trip["updatedAt"] = _now_iso()
    repo.put_group_trip(trip)

    travelers = repo.get_travelers_for_trip(group_trip_id)
    return _trip_to_response(trip, traveler_count=len(travelers))


def delete_group_trip(group_trip_id: str, user_id: str) -> None:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    repo.delete_all_for_trip(group_trip_id)


def get_group_trip_detail(group_trip_id: str, user_id: str) -> GroupTripDetailResponse:
    """Fetch denormalized read model for the frontend."""
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    travelers = repo.get_travelers_for_trip(group_trip_id)
    all_balances = repo.get_all_balances_for_trip(group_trip_id)
    all_prefs = repo.get_all_preferences_for_trip(group_trip_id)
    settlements = repo.get_settlements_for_trip(group_trip_id)
    ledger = repo.get_ledger_for_trip(group_trip_id)

    balances_by_traveler: Dict[str, List[LoyaltyBalanceResponse]] = {}
    for b in all_balances:
        tid = b.get("travelerProfileId", "")
        if tid not in balances_by_traveler:
            balances_by_traveler[tid] = []
        balances_by_traveler[tid].append(_balance_to_response(b))

    prefs_by_traveler: Dict[str, ContributionPreferenceResponse] = {}
    for p in all_prefs:
        tid = p.get("travelerProfileId", "")
        prefs_by_traveler[tid] = _pref_to_response(p)

    return GroupTripDetailResponse(
        trip=_trip_to_response(trip, traveler_count=len(travelers)),
        travelers=[_traveler_to_response(tp) for tp in travelers],
        balances=balances_by_traveler,
        preferences=prefs_by_traveler,
        settlements=[_settlement_to_response(s, travelers) for s in settlements],
        ledger=[_ledger_to_response(e) for e in ledger],
    )


# =============================================================================
# TRAVELER PROFILE CRUD
# =============================================================================

def create_traveler_profile(
    group_trip_id: str, user_id: str, data: TravelerProfileCreate
) -> TravelerProfileResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    now = _now_iso()
    traveler_id = str(uuid.uuid4())

    profile_item = {
        "travelerId": traveler_id,
        "groupTripId": group_trip_id,
        "linkedUserId": None,
        "isGuestProfile": True,
        "displayName": data.display_name,
        "email": data.email,
        "originCity": data.origin_city,
        "originAirport": data.origin_airport,
        "returnAirport": data.return_airport,
        "cabinPreference": data.cabin_preference.value if data.cabin_preference else None,
        "hotelPreference": data.hotel_preference.value if data.hotel_preference else None,
        "roomShareGroupId": data.room_share_group_id,
        "cashBudget": data.cash_budget,
        "checksBags": bool(data.checks_bags),
        "notes": data.notes,
        "createdAt": now,
        "updatedAt": now,
    }
    repo.put_traveler_profile(group_trip_id, profile_item)
    _mark_optimization_stale(trip)
    return _traveler_to_response(profile_item)


def get_travelers(group_trip_id: str, user_id: str) -> List[TravelerProfileResponse]:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    travelers = repo.get_travelers_for_trip(group_trip_id)
    return [_traveler_to_response(tp) for tp in travelers]


def update_traveler_profile(
    group_trip_id: str, traveler_id: str, user_id: str, data: TravelerProfileUpdate
) -> TravelerProfileResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    profile = repo.get_traveler_profile(group_trip_id, traveler_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Traveler profile not found.")

    update_fields = data.model_dump(exclude_none=True)
    field_mapping = {
        "display_name": "displayName",
        "email": "email",
        "origin_city": "originCity",
        "origin_airport": "originAirport",
        "return_airport": "returnAirport",
        "cabin_preference": "cabinPreference",
        "hotel_preference": "hotelPreference",
        "room_share_group_id": "roomShareGroupId",
        "cash_budget": "cashBudget",
        "checks_bags": "checksBags",
        "notes": "notes",
    }

    for py_field, db_field in field_mapping.items():
        if py_field in update_fields:
            val = update_fields[py_field]
            profile[db_field] = val.value if hasattr(val, "value") else val

    profile["updatedAt"] = _now_iso()
    repo.put_traveler_profile(group_trip_id, profile)
    _mark_optimization_stale(trip)
    return _traveler_to_response(profile)


def delete_traveler_profile(group_trip_id: str, traveler_id: str, user_id: str) -> None:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    profile = repo.get_traveler_profile(group_trip_id, traveler_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Traveler profile not found.")

    balances = repo.get_balances_for_traveler(group_trip_id, traveler_id)
    for b in balances:
        repo.delete_loyalty_balance(group_trip_id, traveler_id, b["balanceId"])

    repo.delete_traveler_profile(group_trip_id, traveler_id)
    _mark_optimization_stale(trip)


# =============================================================================
# LOYALTY BALANCE CRUD
# =============================================================================

def create_loyalty_balance(
    group_trip_id: str, traveler_id: str, user_id: str, data: LoyaltyBalanceCreate
) -> LoyaltyBalanceResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    profile = repo.get_traveler_profile(group_trip_id, traveler_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Traveler profile not found.")

    now = _now_iso()
    balance_id = str(uuid.uuid4())

    balance_item = {
        "balanceId": balance_id,
        "travelerProfileId": traveler_id,
        "program": data.program,
        "currencyType": data.currency_type.value,
        "balance": data.balance,
        "transferableFrom": data.transferable_from,
        "centsPerPointAssumption": data.cents_per_point_assumption,
        "isEnabledForPooling": data.is_enabled_for_pooling,
        "createdAt": now,
        "updatedAt": now,
    }
    repo.put_loyalty_balance(group_trip_id, balance_item)
    _mark_optimization_stale(trip)
    return _balance_to_response(balance_item)


def update_loyalty_balance(
    group_trip_id: str, traveler_id: str, balance_id: str, user_id: str, data: LoyaltyBalanceUpdate
) -> LoyaltyBalanceResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    balance = repo.get_loyalty_balance(group_trip_id, traveler_id, balance_id)
    if not balance:
        raise HTTPException(status_code=404, detail="Loyalty balance not found.")

    update_fields = data.model_dump(exclude_none=True)
    field_mapping = {
        "program": "program",
        "currency_type": "currencyType",
        "balance": "balance",
        "transferable_from": "transferableFrom",
        "cents_per_point_assumption": "centsPerPointAssumption",
        "is_enabled_for_pooling": "isEnabledForPooling",
    }

    for py_field, db_field in field_mapping.items():
        if py_field in update_fields:
            val = update_fields[py_field]
            balance[db_field] = val.value if hasattr(val, "value") else val

    balance["updatedAt"] = _now_iso()
    repo.put_loyalty_balance(group_trip_id, balance)
    _mark_optimization_stale(trip)
    return _balance_to_response(balance)


def delete_loyalty_balance(
    group_trip_id: str, traveler_id: str, balance_id: str, user_id: str
) -> None:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    balance = repo.get_loyalty_balance(group_trip_id, traveler_id, balance_id)
    if not balance:
        raise HTTPException(status_code=404, detail="Loyalty balance not found.")

    repo.delete_loyalty_balance(group_trip_id, traveler_id, balance_id)
    _mark_optimization_stale(trip)


def get_balances_for_traveler(
    group_trip_id: str, traveler_id: str, user_id: str
) -> List[LoyaltyBalanceResponse]:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    balances = repo.get_balances_for_traveler(group_trip_id, traveler_id)
    return [_balance_to_response(b) for b in balances]


# =============================================================================
# CONTRIBUTION PREFERENCE
# =============================================================================

def upsert_contribution_preference(
    group_trip_id: str, traveler_id: str, user_id: str, data: ContributionPreferenceUpsert
) -> ContributionPreferenceResponse:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    profile = repo.get_traveler_profile(group_trip_id, traveler_id)
    if not profile:
        raise HTTPException(status_code=404, detail="Traveler profile not found.")

    existing = repo.get_contribution_preference(group_trip_id, traveler_id)
    now = _now_iso()

    pref_item = {
        "prefId": existing["prefId"] if existing else str(uuid.uuid4()),
        "travelerProfileId": traveler_id,
        "maxCashContribution": data.max_cash_contribution,
        "maxPointValueContributionUsd": data.max_point_value_contribution_usd,
        "usePointsPriority": data.use_points_priority.value,
        "allowTransferPartners": data.allow_transfer_partners,
        "allowHotelPoints": data.allow_hotel_points,
        "allowFlightPoints": data.allow_flight_points,
        "createdAt": existing["createdAt"] if existing else now,
        "updatedAt": now,
    }
    repo.put_contribution_preference(group_trip_id, pref_item)
    _mark_optimization_stale(trip)
    return _pref_to_response(pref_item)


def get_contribution_preference(
    group_trip_id: str, traveler_id: str, user_id: str
) -> Optional[ContributionPreferenceResponse]:
    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    _assert_trip_owner(trip, user_id)

    pref = repo.get_contribution_preference(group_trip_id, traveler_id)
    if not pref:
        return None
    return _pref_to_response(pref)


# =============================================================================
# RESPONSE MAPPERS
# =============================================================================

def _trip_to_response(item: Dict[str, Any], traveler_count: int = 0) -> GroupTripResponse:
    return GroupTripResponse(
        id=item["groupTripId"],
        owner_user_id=item["ownerUserId"],
        name=item.get("name", ""),
        destination=item.get("destination", ""),
        start_date=item.get("startDate", ""),
        end_date=item.get("endDate", ""),
        currency=item.get("currency", "USD"),
        status=item.get("status", "draft"),
        split_method=item.get("splitMethod", "points_value_weighted"),
        include_hotels=item.get("includeHotels", False),
        legs=item.get("legs"),
        created_at=item.get("createdAt", ""),
        updated_at=item.get("updatedAt", ""),
        traveler_count=traveler_count,
    )


def _traveler_to_response(item: Dict[str, Any]) -> TravelerProfileResponse:
    return TravelerProfileResponse(
        id=item["travelerId"],
        group_trip_id=item.get("groupTripId", ""),
        linked_user_id=item.get("linkedUserId"),
        is_guest_profile=item.get("isGuestProfile", True),
        display_name=item.get("displayName", ""),
        email=item.get("email"),
        origin_city=item.get("originCity"),
        origin_airport=item.get("originAirport"),
        return_airport=item.get("returnAirport"),
        cabin_preference=item.get("cabinPreference"),
        hotel_preference=item.get("hotelPreference"),
        room_share_group_id=item.get("roomShareGroupId"),
        cash_budget=float(item["cashBudget"]) if item.get("cashBudget") is not None else None,
        checks_bags=bool(item.get("checksBags", False)),
        notes=item.get("notes"),
        created_at=item.get("createdAt", ""),
        updated_at=item.get("updatedAt", ""),
    )


def _balance_to_response(item: Dict[str, Any]) -> LoyaltyBalanceResponse:
    return LoyaltyBalanceResponse(
        id=item["balanceId"],
        traveler_profile_id=item.get("travelerProfileId", ""),
        program=item.get("program", ""),
        currency_type=item.get("currencyType", "bank_points"),
        balance=int(item.get("balance", 0)),
        transferable_from=item.get("transferableFrom"),
        cents_per_point_assumption=float(item["centsPerPointAssumption"]) if item.get("centsPerPointAssumption") is not None else None,
        is_enabled_for_pooling=item.get("isEnabledForPooling", True),
        created_at=item.get("createdAt", ""),
        updated_at=item.get("updatedAt", ""),
    )


def _pref_to_response(item: Dict[str, Any]) -> ContributionPreferenceResponse:
    return ContributionPreferenceResponse(
        id=item.get("prefId", ""),
        traveler_profile_id=item.get("travelerProfileId", ""),
        max_cash_contribution=float(item["maxCashContribution"]) if item.get("maxCashContribution") is not None else None,
        max_point_value_contribution_usd=float(item["maxPointValueContributionUsd"]) if item.get("maxPointValueContributionUsd") is not None else None,
        use_points_priority=item.get("usePointsPriority", "medium"),
        allow_transfer_partners=item.get("allowTransferPartners", True),
        allow_hotel_points=item.get("allowHotelPoints", True),
        allow_flight_points=item.get("allowFlightPoints", True),
        created_at=item.get("createdAt", ""),
        updated_at=item.get("updatedAt", ""),
    )


def _settlement_to_response(item: Dict[str, Any], travelers: List[Dict[str, Any]]) -> Any:
    from src.models.group_planning import SettlementSummaryResponse

    tid = item.get("travelerProfileId", "")
    traveler_name = ""
    for tp in travelers:
        if tp.get("travelerId") == tid:
            traveler_name = tp.get("displayName", "")
            break

    return SettlementSummaryResponse(
        id=item.get("settlementId", ""),
        group_trip_id=item.get("groupTripId", ""),
        traveler_profile_id=tid,
        traveler_name=traveler_name,
        gross_share_usd=float(item.get("grossShareUsd", 0)),
        contributed_value_usd=float(item.get("contributedValueUsd", 0)),
        net_owed_usd=float(item.get("netOwedUsd", 0)),
        net_credit_usd=float(item.get("netCreditUsd", 0)),
        explanation_lines=item.get("explanationLines", []),
        calculation_version=int(item.get("calculationVersion", 1)),
        created_at=item.get("createdAt", ""),
    )


def _ledger_to_response(item: Dict[str, Any]) -> Any:
    from src.models.group_planning import ContributionLedgerEntryResponse

    return ContributionLedgerEntryResponse(
        id=item.get("entryId", ""),
        group_trip_id=item.get("groupTripId", ""),
        traveler_profile_id=item.get("travelerProfileId", ""),
        entry_type=item.get("entryType", ""),
        reference_type=item.get("referenceType", ""),
        reference_id=item.get("referenceId"),
        amount_usd=float(item.get("amountUsd", 0)),
        points_amount=int(item["pointsAmount"]) if item.get("pointsAmount") is not None else None,
        points_program=item.get("pointsProgram"),
        description=item.get("description", ""),
        created_at=item.get("createdAt", ""),
    )
