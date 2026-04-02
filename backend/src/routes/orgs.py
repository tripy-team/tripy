"""
Organization routes — org info, branding, and member management.
"""
import logging
from fastapi import APIRouter, Depends, HTTPException

from ..utils.jwt_auth import OrgContext, get_org_context
from ..repos import org_repo, org_member_repo
from ..schemas.org import (
    OrgResponse,
    UpdateBrandingRequest,
    UpdateAgencyPreferencesRequest,
    OrgMemberResponse,
    AddMemberRequest,
    AgencyPreferences,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/orgs", tags=["Organizations"])


def _org_to_response(org: dict) -> OrgResponse:
    from ..schemas.org import BrandingSettings
    branding_raw = org.get("branding") or {}
    prefs_raw = org.get("agencyPreferences") or {}
    return OrgResponse(
        org_id=org["orgId"],
        name=org["name"],
        owner_id=org["ownerId"],
        plan=org.get("plan", "trial"),
        trial_ends_at=org.get("trialEndsAt"),
        branding=BrandingSettings(
            brand_name=branding_raw.get("brandName"),
            brand_color=branding_raw.get("brandColor", "#1a56db"),
            accent_color=branding_raw.get("accentColor"),
            logo_url=branding_raw.get("logoUrl"),
            font_family=branding_raw.get("fontFamily"),
            email_from_name=branding_raw.get("emailFromName"),
            hide_tripy=branding_raw.get("hideTripy", False),
        ),
        agency_preferences=AgencyPreferences(**prefs_raw) if prefs_raw else None,
        created_at=org["createdAt"],
    )


@router.get("/me", response_model=OrgResponse)
async def get_my_org(ctx: OrgContext = Depends(get_org_context)):
    org = org_repo.get_org(ctx.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    return _org_to_response(org)


@router.patch("/branding")
async def update_branding(
    request: UpdateBrandingRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    if ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can update branding")

    org = org_repo.get_org(ctx.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    branding = org.get("branding") or {}
    if request.brand_name is not None:
        branding["brandName"] = request.brand_name
    if request.brand_color is not None:
        branding["brandColor"] = request.brand_color
    if request.accent_color is not None:
        branding["accentColor"] = request.accent_color
    if request.logo_url is not None:
        branding["logoUrl"] = request.logo_url
    if request.font_family is not None:
        branding["fontFamily"] = request.font_family
    if request.email_from_name is not None:
        branding["emailFromName"] = request.email_from_name
    if request.hide_tripy is not None:
        branding["hideTripy"] = request.hide_tripy

    org_repo.update_org(ctx.org_id, {"branding": branding})
    return {"ok": True}


@router.get("/members")
async def list_members(ctx: OrgContext = Depends(get_org_context)):
    members = org_member_repo.list_members(ctx.org_id)
    return [
        OrgMemberResponse(
            org_id=m["orgId"],
            user_id=m["userId"],
            role=m.get("role", "member"),
            created_at=m.get("createdAt", ""),
        )
        for m in members
    ]


@router.post("/members")
async def add_member(
    request: AddMemberRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    if ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can add members")

    from datetime import datetime, timezone
    email = request.email.strip().lower()

    # Check if user already exists in Cognito / user table
    from ..repos import user_repo
    existing_user = user_repo.get_user_by_email(email)

    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    if existing_user:
        target_user_id = existing_user["userId"]
        existing_member = org_member_repo.get_member(ctx.org_id, target_user_id)
        if existing_member:
            raise HTTPException(status_code=409, detail="User is already a member")
        org_member_repo.add_member({
            "orgId": ctx.org_id,
            "userId": target_user_id,
            "role": request.role,
            "createdAt": now,
        })
    else:
        # Store with email as placeholder userId until they sign up
        placeholder_id = f"pending_{email}"
        existing_member = org_member_repo.get_member(ctx.org_id, placeholder_id)
        if existing_member:
            raise HTTPException(status_code=409, detail="Invite already pending for this email")
        org_member_repo.add_member({
            "orgId": ctx.org_id,
            "userId": placeholder_id,
            "role": request.role,
            "pendingEmail": email,
            "createdAt": now,
        })

    return {"ok": True, "message": f"Member added: {email}"}


@router.delete("/members/{user_id}")
async def remove_member(
    user_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    if ctx.role != "owner":
        raise HTTPException(status_code=403, detail="Only the owner can remove members")
    if user_id == ctx.user_id:
        raise HTTPException(status_code=400, detail="Cannot remove yourself")

    org_member_repo.remove_member(ctx.org_id, user_id)
    return {"ok": True}


# =============================================================================
# Feature 15: Agency-level preferences
# =============================================================================

@router.get("/preferences")
async def get_agency_preferences(ctx: OrgContext = Depends(get_org_context)):
    """Get agency-level operational preferences."""
    org = org_repo.get_org(ctx.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    prefs_raw = org.get("agencyPreferences") or {}
    return AgencyPreferences(**prefs_raw) if prefs_raw else AgencyPreferences()


@router.patch("/preferences")
async def update_agency_preferences(
    request: UpdateAgencyPreferencesRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    """Update agency-level operational preferences (owner/admin only)."""
    if ctx.role not in ("owner", "admin"):
        raise HTTPException(status_code=403, detail="Only owner or admin can update preferences")

    org = org_repo.get_org(ctx.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    prefs = org.get("agencyPreferences") or {}
    update_data = request.model_dump(exclude_none=True)
    for key, value in update_data.items():
        camel_key = key
        prefs[camel_key] = value

    org_repo.update_org(ctx.org_id, {"agencyPreferences": prefs})
    return {"ok": True}


# =============================================================================
# Feature 12: Org activity feed
# =============================================================================

@router.get("/activity")
async def get_org_activity(
    limit: int = 50,
    ctx: OrgContext = Depends(get_org_context),
):
    """Get recent activity across the org."""
    from ..repos.ddb import query_gsi, table
    from ..config import TRIPS_TABLE

    trips = query_gsi(table(TRIPS_TABLE), "orgId-index", "orgId", ctx.org_id)
    trips.sort(key=lambda x: x.get("createdAt", ""), reverse=True)

    activities = []
    for t in trips[:limit]:
        activities.append({
            "timestamp": t.get("createdAt", ""),
            "user_id": t.get("createdBy", ""),
            "action": "created",
            "detail": f"Trip: {t.get('title', 'Untitled')}",
            "trip_id": t.get("tripId", ""),
            "client_id": t.get("clientId", ""),
        })

    return {"activities": activities[:limit]}
