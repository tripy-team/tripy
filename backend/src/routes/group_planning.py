"""
Group Planning Routes

API endpoints for organizer-managed group trip planning.
All endpoints require authentication; only the trip owner can access their trips.
"""

from typing import Optional
from fastapi import APIRouter, Depends
from src.utils.jwt_auth import get_current_user_id
from src.models.group_planning import (
    GroupTripCreate, GroupTripUpdate, GroupTripResponse,
    TravelerProfileCreate, TravelerProfileUpdate, TravelerProfileResponse,
    LoyaltyBalanceCreate, LoyaltyBalanceUpdate, LoyaltyBalanceResponse,
    ContributionPreferenceUpsert, ContributionPreferenceResponse,
    ManualAdjustmentCreate,
    GroupTripDetailResponse,
    ContributionLedgerEntryResponse,
    SettlementSummaryResponse,
)
from src.services import group_planning_service as service

router = APIRouter(prefix="/group-trips", tags=["group-planning"])


# =============================================================================
# GROUP TRIP CRUD
# =============================================================================

@router.post("", response_model=GroupTripResponse, status_code=201)
async def create_group_trip(
    body: GroupTripCreate,
    user_id: str = Depends(get_current_user_id),
):
    return service.create_group_trip(user_id, body)


@router.get("", response_model=list[GroupTripResponse])
async def list_group_trips(
    user_id: str = Depends(get_current_user_id),
):
    return service.list_group_trips(user_id)


@router.get("/{group_trip_id}", response_model=GroupTripResponse)
async def get_group_trip(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return service.get_group_trip(group_trip_id, user_id)


@router.get("/{group_trip_id}/detail", response_model=GroupTripDetailResponse)
async def get_group_trip_detail(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return service.get_group_trip_detail(group_trip_id, user_id)


@router.patch("/{group_trip_id}", response_model=GroupTripResponse)
async def update_group_trip(
    group_trip_id: str,
    body: GroupTripUpdate,
    user_id: str = Depends(get_current_user_id),
):
    return service.update_group_trip(group_trip_id, user_id, body)


@router.delete("/{group_trip_id}", status_code=204)
async def delete_group_trip(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    service.delete_group_trip(group_trip_id, user_id)


# =============================================================================
# TRAVELER PROFILES
# =============================================================================

@router.post(
    "/{group_trip_id}/travelers",
    response_model=TravelerProfileResponse,
    status_code=201,
)
async def create_traveler(
    group_trip_id: str,
    body: TravelerProfileCreate,
    user_id: str = Depends(get_current_user_id),
):
    return service.create_traveler_profile(group_trip_id, user_id, body)


@router.get(
    "/{group_trip_id}/travelers",
    response_model=list[TravelerProfileResponse],
)
async def list_travelers(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return service.get_travelers(group_trip_id, user_id)


@router.patch(
    "/{group_trip_id}/travelers/{traveler_id}",
    response_model=TravelerProfileResponse,
)
async def update_traveler(
    group_trip_id: str,
    traveler_id: str,
    body: TravelerProfileUpdate,
    user_id: str = Depends(get_current_user_id),
):
    return service.update_traveler_profile(group_trip_id, traveler_id, user_id, body)


@router.delete("/{group_trip_id}/travelers/{traveler_id}", status_code=204)
async def delete_traveler(
    group_trip_id: str,
    traveler_id: str,
    user_id: str = Depends(get_current_user_id),
):
    service.delete_traveler_profile(group_trip_id, traveler_id, user_id)


# =============================================================================
# LOYALTY BALANCES
# =============================================================================

@router.post(
    "/{group_trip_id}/travelers/{traveler_id}/balances",
    response_model=LoyaltyBalanceResponse,
    status_code=201,
)
async def create_balance(
    group_trip_id: str,
    traveler_id: str,
    body: LoyaltyBalanceCreate,
    user_id: str = Depends(get_current_user_id),
):
    return service.create_loyalty_balance(group_trip_id, traveler_id, user_id, body)


@router.get(
    "/{group_trip_id}/travelers/{traveler_id}/balances",
    response_model=list[LoyaltyBalanceResponse],
)
async def list_balances(
    group_trip_id: str,
    traveler_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return service.get_balances_for_traveler(group_trip_id, traveler_id, user_id)


@router.patch(
    "/{group_trip_id}/travelers/{traveler_id}/balances/{balance_id}",
    response_model=LoyaltyBalanceResponse,
)
async def update_balance(
    group_trip_id: str,
    traveler_id: str,
    balance_id: str,
    body: LoyaltyBalanceUpdate,
    user_id: str = Depends(get_current_user_id),
):
    return service.update_loyalty_balance(group_trip_id, traveler_id, balance_id, user_id, body)


@router.delete(
    "/{group_trip_id}/travelers/{traveler_id}/balances/{balance_id}",
    status_code=204,
)
async def delete_balance(
    group_trip_id: str,
    traveler_id: str,
    balance_id: str,
    user_id: str = Depends(get_current_user_id),
):
    service.delete_loyalty_balance(group_trip_id, traveler_id, balance_id, user_id)


# =============================================================================
# CONTRIBUTION PREFERENCES
# =============================================================================

@router.put(
    "/{group_trip_id}/travelers/{traveler_id}/preferences",
    response_model=ContributionPreferenceResponse,
)
async def upsert_preferences(
    group_trip_id: str,
    traveler_id: str,
    body: ContributionPreferenceUpsert,
    user_id: str = Depends(get_current_user_id),
):
    return service.upsert_contribution_preference(group_trip_id, traveler_id, user_id, body)


@router.get(
    "/{group_trip_id}/travelers/{traveler_id}/preferences",
    response_model=Optional[ContributionPreferenceResponse],
)
async def get_preferences(
    group_trip_id: str,
    traveler_id: str,
    user_id: str = Depends(get_current_user_id),
):
    return service.get_contribution_preference(group_trip_id, traveler_id, user_id)


# =============================================================================
# OPTIMIZATION (Phase 2 stubs)
# =============================================================================

@router.post("/{group_trip_id}/optimize")
async def optimize_group_trip(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from src.services.group_optimization_service import optimize_group_trip as _optimize
    return await _optimize(group_trip_id, user_id)


@router.get("/{group_trip_id}/optimization-result")
async def get_optimization_result(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from src.services.group_optimization_service import get_optimization_result as _get
    return _get(group_trip_id, user_id)


# =============================================================================
# SETTLEMENT (Phase 3 stubs)
# =============================================================================

@router.post("/{group_trip_id}/calculate-split")
async def calculate_split(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from src.services.group_split_calculator import calculate_split as _calc
    return _calc(group_trip_id, user_id)


@router.get("/{group_trip_id}/settlement", response_model=list[SettlementSummaryResponse])
async def get_settlement(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from src.services import group_planning_service as svc
    trip = svc.get_group_trip(group_trip_id, user_id)
    from src.repos import group_planning_repo as repo
    settlements = repo.get_settlements_for_trip(group_trip_id)
    travelers = repo.get_travelers_for_trip(group_trip_id)
    return [svc._settlement_to_response(s, travelers) for s in settlements]


@router.get("/{group_trip_id}/ledger", response_model=list[ContributionLedgerEntryResponse])
async def get_ledger(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    from src.services import group_planning_service as svc
    trip = svc.get_group_trip(group_trip_id, user_id)
    from src.repos import group_planning_repo as repo
    entries = repo.get_ledger_for_trip(group_trip_id)
    return [svc._ledger_to_response(e) for e in entries]


@router.get("/{group_trip_id}/settlement/reimbursements")
async def get_reimbursements(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Compute who-owes-whom reimbursement transfers."""
    from src.services.group_split_calculator import compute_reimbursements as _reimburse
    return _reimburse(group_trip_id, user_id)


@router.post("/{group_trip_id}/settlement/manual-adjustment", status_code=201)
async def manual_adjustment(
    group_trip_id: str,
    body: ManualAdjustmentCreate,
    user_id: str = Depends(get_current_user_id),
):
    from src.services.group_split_calculator import add_manual_adjustment as _adjust
    return _adjust(group_trip_id, user_id, body)


# =============================================================================
# POOL SUMMARY
# =============================================================================

@router.get("/{group_trip_id}/pool-summary")
async def pool_summary(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get aggregated points pool summary for the group."""
    from src.services.group_optimization_service import get_pool_summary as _pool
    return _pool(group_trip_id, user_id)


# =============================================================================
# TRANSFER INSTRUCTIONS
# =============================================================================

@router.get("/{group_trip_id}/transfer-instructions")
async def transfer_instructions(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get transfer instructions for cross-member point usage."""
    from src.services.group_optimization_service import get_transfer_instructions as _xfer
    return _xfer(group_trip_id, user_id)


# =============================================================================
# BOOKING CHECKLIST
# =============================================================================

@router.get("/{group_trip_id}/booking-checklist")
async def booking_checklist(
    group_trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get per-traveler booking checklist with tasks."""
    from src.services.group_optimization_service import get_booking_checklist as _checklist
    return _checklist(group_trip_id, user_id)


# =============================================================================
# POOLING SCOPE
# =============================================================================

@router.patch("/{group_trip_id}/pooling-scope")
async def update_pooling_scope(
    group_trip_id: str,
    body: dict,
    user_id: str = Depends(get_current_user_id),
):
    """Update the trip's pooling scope (individual_only, household_only, full_group, sponsors_only)."""
    from fastapi import HTTPException
    from datetime import datetime
    from src.repos import group_planning_repo as repo

    trip = repo.get_group_trip(group_trip_id)
    if not trip:
        raise HTTPException(status_code=404, detail="Group trip not found.")
    if trip.get("ownerUserId") != user_id:
        raise HTTPException(status_code=403, detail="Only the trip owner can update pooling scope.")

    scope = body.get("pooling_scope", "full_group")
    valid_scopes = {"individual_only", "household_only", "full_group", "sponsors_only"}
    if scope not in valid_scopes:
        raise HTTPException(status_code=400, detail=f"Invalid pooling scope. Must be one of: {valid_scopes}")

    previous = trip.get("poolingScope", "individual_only")
    trip["poolingScope"] = scope
    trip["updatedAt"] = datetime.utcnow().isoformat() + "Z"
    repo.put_group_trip(trip)

    # Invalidate existing optimization if scope changed
    plan_invalidated = previous != scope and trip.get("status") == "ready"
    if plan_invalidated:
        trip["status"] = "draft"
        repo.put_group_trip(trip)

    return {
        "ok": True,
        "pooling_scope": scope,
        "plan_invalidated": plan_invalidated,
    }
