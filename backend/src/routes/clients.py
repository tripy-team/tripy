"""
Client management routes — CRUD for advisor client portfolios.
"""
import uuid
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from ..utils.jwt_auth import OrgContext, get_org_context
from ..repos import client_repo, client_points_repo
from ..repos.ddb import query_gsi, table
from ..schemas.client import (
    CreateClientRequest,
    UpdateClientRequest,
    ClientResponse,
    ClientPointBalance,
    UpsertClientPointsRequest,
    ClientPointsResponse,
)
from ..config import TRIPS_TABLE

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/clients", tags=["Clients"])


def _client_to_response(c: dict) -> ClientResponse:
    from ..schemas.client import ClientPreferences, ClientStats, FamilyMember
    prefs_raw = c.get("preferences") or {}
    stats_raw = c.get("stats") or {}
    family_raw = c.get("familyMembers") or []

    prefs = ClientPreferences(
        flight_class=prefs_raw.get("flightClass"),
        preferred_airlines=prefs_raw.get("preferredAirlines", []),
        preferred_airports=prefs_raw.get("preferredAirports", []),
        cabin_default=prefs_raw.get("cabinDefault"),
        budget_style=prefs_raw.get("budgetStyle"),
        avoid_constraints=prefs_raw.get("avoidConstraints", []),
        positive_constraints=prefs_raw.get("positiveConstraints", []),
    ) if prefs_raw else None

    family = [
        FamilyMember(
            name=m.get("name", ""),
            relationship=m.get("relationship", ""),
            age=m.get("age"),
            loyalty_programs=m.get("loyaltyPrograms", []),
            notes=m.get("notes"),
        )
        for m in family_raw
    ]

    return ClientResponse(
        org_id=c["orgId"],
        client_id=c["clientId"],
        name=c["name"],
        email=c.get("email"),
        home_airport=c.get("homeAirport"),
        notes=c.get("notes"),
        preferences=prefs,
        family_members=family,
        stats=ClientStats(
            total_trips=int(stats_raw.get("totalTrips", 0)),
            total_savings=float(stats_raw.get("totalSavings", 0)),
            total_points_optimized=int(stats_raw.get("totalPointsOptimized", 0)),
        ) if stats_raw else None,
        is_self_client=c.get("isSelfClient", False),
        created_by=c.get("createdBy"),
        created_at=c.get("createdAt", ""),
        travel_history_summary=c.get("travelHistorySummary"),
    )


@router.post("", response_model=ClientResponse)
async def create_client(
    request: CreateClientRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    client_id = f"client_{uuid.uuid4()}"

    prefs_dict = {}
    if request.preferences:
        prefs_dict = {
            "flightClass": request.preferences.flight_class,
            "preferredAirlines": request.preferences.preferred_airlines,
            "preferredAirports": request.preferences.preferred_airports,
            "cabinDefault": request.preferences.cabin_default,
            "budgetStyle": request.preferences.budget_style,
            "avoidConstraints": request.preferences.avoid_constraints,
            "positiveConstraints": request.preferences.positive_constraints,
        }

    family_list = []
    if request.family_members:
        for m in request.family_members:
            family_list.append({
                "name": m.name,
                "relationship": m.relationship,
                "age": m.age,
                "loyaltyPrograms": m.loyalty_programs,
                "notes": m.notes,
            })

    item = {
        "orgId": ctx.org_id,
        "clientId": client_id,
        "name": request.name,
        "email": request.email,
        "homeAirport": request.home_airport,
        "notes": request.notes,
        "preferences": prefs_dict,
        "familyMembers": family_list,
        "stats": {"totalTrips": 0, "totalSavings": 0, "totalPointsOptimized": 0},
        "isSelfClient": False,
        "createdBy": ctx.user_id,
        "createdAt": now,
    }
    client_repo.create_client(item)

    if request.initial_points:
        for p in request.initial_points:
            client_points_repo.upsert_point(ctx.org_id, client_id, {
                "program": p.get("program", ""),
                "balance": int(p.get("balance", 0)),
                "updatedAt": now,
                "updatedBy": ctx.user_id,
            })

    return _client_to_response(item)


@router.get("")
async def list_clients(
    ctx: OrgContext = Depends(get_org_context),
    limit: int = 100,
):
    items = client_repo.list_clients(ctx.org_id, limit=limit)
    return [_client_to_response(c) for c in items]


@router.get("/{client_id}", response_model=ClientResponse)
async def get_client(
    client_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    c = client_repo.get_client(ctx.org_id, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")
    return _client_to_response(c)


@router.patch("/{client_id}", response_model=ClientResponse)
async def update_client(
    client_id: str,
    request: UpdateClientRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    c = client_repo.get_client(ctx.org_id, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")

    updates = {}
    if request.name is not None:
        updates["name"] = request.name
    if request.email is not None:
        updates["email"] = request.email
    if request.home_airport is not None:
        updates["homeAirport"] = request.home_airport
    if request.notes is not None:
        updates["notes"] = request.notes
    if request.preferences is not None:
        updates["preferences"] = {
            "flightClass": request.preferences.flight_class,
            "preferredAirlines": request.preferences.preferred_airlines,
            "preferredAirports": request.preferences.preferred_airports,
            "cabinDefault": request.preferences.cabin_default,
            "budgetStyle": request.preferences.budget_style,
            "avoidConstraints": request.preferences.avoid_constraints,
            "positiveConstraints": request.preferences.positive_constraints,
        }
    if request.family_members is not None:
        updates["familyMembers"] = [
            {
                "name": m.name,
                "relationship": m.relationship,
                "age": m.age,
                "loyaltyPrograms": m.loyalty_programs,
                "notes": m.notes,
            }
            for m in request.family_members
        ]

    if updates:
        client_repo.update_client(ctx.org_id, client_id, updates)
        c.update(updates)

    return _client_to_response(c)


@router.get("/{client_id}/points", response_model=ClientPointsResponse)
async def get_client_points(
    client_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    c = client_repo.get_client(ctx.org_id, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")

    items = client_points_repo.list_points(ctx.org_id, client_id)
    points = [
        ClientPointBalance(
            program=p["program"],
            balance=int(p.get("balance", 0)),
            updated_at=p.get("updatedAt"),
            updated_by=p.get("updatedBy"),
        )
        for p in items
    ]
    total = sum(p.balance for p in points)
    return ClientPointsResponse(
        org_id=ctx.org_id,
        client_id=client_id,
        points=points,
        total_points=total,
    )


@router.put("/{client_id}/points", response_model=ClientPointsResponse)
async def upsert_client_points(
    client_id: str,
    request: UpsertClientPointsRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    c = client_repo.get_client(ctx.org_id, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    new_items = []
    for p in request.points:
        new_items.append({
            "program": p.program,
            "balance": p.balance,
            "updatedAt": now,
            "updatedBy": ctx.user_id,
        })
    client_points_repo.replace_all_points(ctx.org_id, client_id, new_items)

    return await get_client_points(client_id, ctx)


@router.get("/{client_id}/trips")
async def list_client_trips(
    client_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    c = client_repo.get_client(ctx.org_id, client_id)
    if not c:
        raise HTTPException(status_code=404, detail="Client not found")

    trips = query_gsi(table(TRIPS_TABLE), "orgId-index", "orgId", ctx.org_id)
    client_trips = [t for t in trips if t.get("clientId") == client_id]
    client_trips.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

    return [
        {
            "tripId": t.get("tripId"),
            "title": t.get("title"),
            "origin": t.get("origin"),
            "destinations": t.get("destinations", []),
            "status": t.get("status"),
            "estimatedSavings": t.get("estimatedSavings"),
            "createdAt": t.get("createdAt"),
        }
        for t in client_trips
    ]
