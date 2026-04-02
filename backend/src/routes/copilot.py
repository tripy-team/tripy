"""
Copilot routes — AI assistant for advisors to iterate on recommendations.
"""
import logging
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..utils.jwt_auth import get_current_user_id
from ..agents.advisor_copilot import CopilotRequest, CopilotResponse, get_copilot

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/copilot", tags=["Copilot"])


class CopilotMessageRequest(BaseModel):
    message: str
    trip_id: str
    current_constraints: Dict = {}
    current_recommendations: List[Dict] = []
    conversation_history: List[Dict] = []


@router.post("/message", response_model=CopilotResponse)
async def copilot_message(
    request: CopilotMessageRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Send a message to the advisor copilot."""
    copilot = get_copilot()

    copilot_request = CopilotRequest(
        message=request.message,
        trip_id=request.trip_id,
        current_constraints=request.current_constraints,
        current_recommendations=request.current_recommendations,
        conversation_history=request.conversation_history,
    )

    try:
        response = await copilot.execute(copilot_request)
        return response
    except Exception as e:
        logger.error(f"Copilot error: {e}", exc_info=True)
        return CopilotResponse(
            reply="Something went wrong. Please try again.",
            suggestions=["Try rephrasing your request."],
        )


class QuickActionRequest(BaseModel):
    action: str  # make_cheaper | more_comfort | fewer_stops | change_points_strategy | nonstop_only
    trip_id: str
    current_constraints: Dict = {}


QUICK_ACTION_MESSAGES = {
    "make_cheaper": "Make this trip cheaper — minimize out-of-pocket cost.",
    "more_comfort": "I want more comfort — upgrade cabin class and prefer nonstop flights.",
    "fewer_stops": "Reduce the number of stops — prefer direct or 1-stop maximum.",
    "change_points_strategy": "Maximize points usage — use points first before cash.",
    "nonstop_only": "Only show nonstop flights.",
    "remove_self_transfers": "Remove any options with self-transfers.",
    "business_class": "Show me business class options.",
}


@router.post("/quick-action", response_model=CopilotResponse)
async def copilot_quick_action(
    request: QuickActionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """Execute a predefined quick action through the copilot."""
    message = QUICK_ACTION_MESSAGES.get(request.action)
    if not message:
        raise HTTPException(status_code=400, detail=f"Unknown quick action: {request.action}")

    copilot = get_copilot()

    copilot_request = CopilotRequest(
        message=message,
        trip_id=request.trip_id,
        current_constraints=request.current_constraints,
    )

    try:
        response = await copilot.execute(copilot_request)
        return response
    except Exception as e:
        logger.error(f"Copilot quick action error: {e}", exc_info=True)
        return CopilotResponse(
            reply="Something went wrong. Please try again.",
        )
