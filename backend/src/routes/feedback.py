"""
Feedback routes — Capture structured feedback at every decision point.
"""
import logging
from typing import Dict, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..utils.jwt_auth import OrgContext, get_org_context
from ..services import feedback_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/feedback", tags=["Feedback"])


class FeedbackEventRequest(BaseModel):
    trip_id: str
    event_type: str
    data: Dict = {}
    client_id: Optional[str] = None


@router.post("/event")
async def record_feedback_event(
    request: FeedbackEventRequest,
    ctx: OrgContext = Depends(get_org_context),
):
    """Record a feedback event."""
    valid_types = {
        "recommendation_selected",
        "recommendation_edited",
        "recommendation_rejected",
        "proposal_sent",
        "client_responded",
        "booking_completed",
        "booking_failed",
        "plan_changed",
        "reoptimization_accepted",
    }

    if request.event_type not in valid_types:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid event type. Must be one of: {', '.join(sorted(valid_types))}",
        )

    event_id = feedback_service.record_feedback(
        org_id=ctx.org_id,
        trip_id=request.trip_id,
        advisor_id=ctx.user_id,
        event_type=request.event_type,
        data=request.data,
        client_id=request.client_id,
    )

    return {"ok": True, "event_id": event_id}


@router.get("/trip/{trip_id}")
async def get_trip_feedback(
    trip_id: str,
    ctx: OrgContext = Depends(get_org_context),
):
    """Get feedback timeline for a trip."""
    events = feedback_service.get_trip_feedback(ctx.org_id, trip_id)
    return {"trip_id": trip_id, "events": events}


@router.get("/stats")
async def get_feedback_stats(
    ctx: OrgContext = Depends(get_org_context),
):
    """Get aggregate feedback statistics for the org."""
    stats = feedback_service.get_org_feedback_stats(ctx.org_id)
    return stats
