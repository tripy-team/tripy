"""
Proposal routes — Create and manage client-facing proposals.
"""
import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..utils.jwt_auth import OrgContext, get_org_context
from ..services import proposal_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/proposals", tags=["Proposals"])


class CreateProposalRequest(BaseModel):
    trip_id: str
    client_id: str
    client_name: str
    recommendations: List[dict]
    advisor_note: str = ""
    trip_summary: str = ""
    show_alternatives: bool = True
    show_booking_steps: bool = True
    show_points_breakdown: bool = True


class SendProposalRequest(BaseModel):
    email: str


@router.post("")
async def create_proposal(
    request: CreateProposalRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    """Create a client-facing proposal from trip results."""
    from ..repos import org_repo

    org = org_repo.get_org(ctx.org_id)
    branding = org.get("branding", {}) if org else {}

    try:
        result = proposal_service.create_proposal(
            trip_id=request.trip_id,
            org_id=ctx.org_id,
            client_id=request.client_id,
            client_name=request.client_name,
            advisor_id=ctx.user_id,
            recommendations=request.recommendations,
            advisor_note=request.advisor_note,
            trip_summary=request.trip_summary,
            show_alternatives=request.show_alternatives,
            show_booking_steps=request.show_booking_steps,
            show_points_breakdown=request.show_points_breakdown,
            branding=branding,
        )
        return result
    except Exception as e:
        logger.error(f"Failed to create proposal: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Failed to create proposal")


@router.get("")
async def list_proposals(
    ctx: OrgContext = Depends(get_org_context),
    limit: int = 50,
):
    """List proposals for the org."""
    return proposal_service.list_proposals(ctx.org_id, limit=limit)


@router.get("/{proposal_id}")
async def get_proposal(
    proposal_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    """Get a specific proposal (advisor view)."""
    prop = proposal_service.get_proposal(ctx.org_id, proposal_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found")
    return prop


@router.get("/shared/{share_token}")
async def get_shared_proposal(share_token: str):
    """Get a proposal by share token (public client view, no auth)."""
    prop = proposal_service.get_proposal_by_token(share_token)
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found or expired")
    return prop


@router.post("/{proposal_id}/send")
async def send_proposal(
    proposal_id: str,
    request: SendProposalRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    """Email a proposal link to the client."""
    prop = proposal_service.get_proposal(ctx.org_id, proposal_id)
    if not prop:
        raise HTTPException(status_code=404, detail="Proposal not found")

    share_url = prop.get("share_url", "")
    client_name = prop.get("client_name", "")
    advisor_note = prop.get("advisor_note", "")
    branding = prop.get("branding", {})
    brand_name = branding.get("brandName", "Your Trip Hacker")

    try:
        from ..services.email_service import send_email, is_email_enabled
        from ..config import FRONTEND_URL

        if not is_email_enabled():
            return {"ok": True, "message": "Email not configured — share the link manually.", "share_url": share_url}

        full_url = f"{FRONTEND_URL}{share_url}"

        result = send_email(
            to_email=request.email,
            subject=f"Your Travel Recommendations from {brand_name}",
            html_body=f"""
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #1e40af;">{brand_name}</h2>
                <p>Hi {client_name},</p>
                {f'<p>{advisor_note}</p>' if advisor_note else ''}
                <p>I've prepared your travel recommendations. Click below to view your options:</p>
                <div style="text-align: center; margin: 24px 0;">
                    <a href="{full_url}" style="display: inline-block; background: #2563eb; color: white; text-decoration: none; padding: 14px 32px; border-radius: 10px; font-weight: 600;">
                        View Your Recommendations
                    </a>
                </div>
                <p style="color: #64748b; font-size: 14px;">This link is valid for 30 days.</p>
                <p style="color: #94a3b8; font-size: 12px;">Sent via {brand_name}</p>
            </div>
            """,
            text_body=f"Hi {client_name}, view your travel recommendations: {full_url}",
        )

        if result.get("success"):
            return {"ok": True, "message": "Proposal sent successfully"}
        return {"ok": False, "message": "Failed to send email", "share_url": share_url}

    except Exception as e:
        logger.error(f"Failed to send proposal email: {e}")
        return {"ok": False, "message": "Failed to send email", "share_url": share_url}
