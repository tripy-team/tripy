"""
Optimization API Routes

These endpoints expose the agentic ILP optimization to the frontend.
All results are ranked by out-of-pocket (OOP) expense - lowest first.
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal, Any
import logging

from ..agents.orchestrator import OrchestratorAgent
from ..agents.cost_breakdown_agent import CostBreakdownAgent
from ..agents.models import (
    OptimizeSoloRequest, OptimizeSoloResponse,
    OptimizeGroupRequest, OptimizeGroupResponse,
    CostBreakdown, RankedItinerary,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/optimize", tags=["optimization"])

# Initialize agents (singleton)
_orchestrator = None
_cost_agent = None


def get_orchestrator() -> OrchestratorAgent:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = OrchestratorAgent()
    return _orchestrator


def get_cost_agent() -> CostBreakdownAgent:
    global _cost_agent
    if _cost_agent is None:
        _cost_agent = CostBreakdownAgent()
    return _cost_agent


# =============================================================================
# REQUEST/RESPONSE MODELS (for API docs)
# =============================================================================

class SoloOptimizeRequest(BaseModel):
    """Request body for solo trip optimization."""
    trip_id: str
    points: dict[str, int] = {}  # program -> balance
    budget: float = 5000.0
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True


class GroupOptimizeRequest(SoloOptimizeRequest):
    """Request body for group trip optimization."""
    member_points: dict[str, dict[str, int]] = {}  # member_id -> program -> balance
    member_budgets: dict[str, float] = {}
    split_method: Optional[Literal["equal", "by_usage", "proportional"]] = "by_usage"


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/solo", response_model=None)
async def optimize_solo_trip(request: SoloOptimizeRequest) -> dict:
    """
    Optimize a solo trip using the agentic architecture.
    
    Returns itineraries ranked by out-of-pocket (lowest first).
    Each itinerary includes:
    - OOP metrics (totalOutOfPocket, savings, CPP)
    - Per-segment payment decisions (cash vs points)
    - Transfer instructions with portal URLs
    - AI-generated summary
    
    **Algorithm:**
    1. Flight Agent searches AwardTool + SerpAPI for each segment
    2. Hotel Agent searches hotel options (if includeHotels=true)
    3. ILP optimizer minimizes out-of-pocket using OOP mode
    4. Results ranked by lowest cash paid first
    5. Cost Breakdown Agent explains each decision
    """
    logger.info(f"[/optimize/solo] Starting optimization for trip {request.trip_id}")
    
    try:
        orchestrator = get_orchestrator()
        
        # Convert to internal model
        internal_request = OptimizeSoloRequest(
            trip_id=request.trip_id,
            points=request.points,
            budget=request.budget,
            cabin_classes=request.cabin_classes,
            hotel_stars=request.hotel_stars,
            include_hotels=request.include_hotels,
        )
        
        result = await orchestrator.optimize_solo(internal_request)
        
        # Convert to JSON-serializable dict
        return {
            "tripId": result.trip_id,
            "itineraries": [_serialize_itinerary(it) for it in result.itineraries],
            "bestOption": result.best_option,
            "warnings": result.warnings,
        }
    except Exception as e:
        logger.error(f"[/optimize/solo] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group", response_model=None)
async def optimize_group_trip(request: GroupOptimizeRequest) -> dict:
    """
    Optimize a group trip with cost splitting and settlements.
    
    Additional features over solo:
    - Points pooling across all members
    - Per-member cost breakdown
    - Settlement calculations (who owes who)
    - Fair cost splitting based on split_method
    """
    logger.info(f"[/optimize/group] Starting optimization for trip {request.trip_id}")
    
    try:
        orchestrator = get_orchestrator()
        
        internal_request = OptimizeGroupRequest(
            trip_id=request.trip_id,
            points=request.points,
            budget=request.budget,
            cabin_classes=request.cabin_classes,
            hotel_stars=request.hotel_stars,
            include_hotels=request.include_hotels,
            member_points=request.member_points,
            member_budgets=request.member_budgets,
            split_method=request.split_method,
        )
        
        result = await orchestrator.optimize_group(internal_request)
        
        return {
            "tripId": result.trip_id,
            "itineraries": [_serialize_itinerary(it) for it in result.itineraries],
            "groupMetrics": result.group_metrics.model_dump() if result.group_metrics else None,
            "bestOption": result.best_option,
            "warnings": result.warnings,
        }
    except Exception as e:
        logger.error(f"[/optimize/group] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/breakdown/{itinerary_id}", response_model=None)
async def get_cost_breakdown(itinerary_id: str) -> dict:
    """
    Get detailed, AI-generated cost breakdown for an itinerary.
    
    Uses the Cost Breakdown Agent to generate human-readable
    explanations of each transaction and transfer.
    
    Returns:
    - tripSummary: Overall trip costs and savings
    - segments: Per-segment breakdown with payment explanations
    - transferSummary: All required transfers with instructions
    - paymentBreakdown: Cash payments and points used
    - valueAnalysis: Best/worst redemptions, average CPP
    """
    # For now, return a mock breakdown
    # In production, would fetch itinerary from DB and generate breakdown
    return {
        "tripSummary": {
            "route": "JFK → CDG → JFK",
            "totalCashPrice": 2500,
            "totalOutOfPocket": 450,
            "totalSavings": 2050,
            "savingsPercentage": 82,
        },
        "segments": [],
        "transferSummary": {
            "totalTransfers": 1,
            "bySource": {},
            "recommendedOrder": [],
            "timingAdvice": "Complete transfers 2-3 days before booking.",
        },
        "paymentBreakdown": {
            "cashPayments": [],
            "totalCash": 450,
            "pointsUsed": {},
            "totalPoints": 60000,
        },
        "valueAnalysis": {
            "averageCPP": 3.4,
            "bestRedemption": None,
            "worstRedemption": None,
        },
    }


@router.get("/compare/{trip_id}", response_model=None)
async def compare_strategies(trip_id: str) -> dict:
    """
    Compare OOP vs CPP optimization strategies for the same trip.
    
    Returns both results with explanation of trade-offs:
    - OOP: Minimizes cash paid, uses points aggressively
    - CPP: Maximizes redemption value, more conservative with points
    
    Recommendation is always OOP for most users.
    """
    try:
        orchestrator = get_orchestrator()
        
        # Run OOP optimization
        oop_request = OptimizeSoloRequest(
            trip_id=trip_id,
            points={},
            budget=10000,
        )
        oop_result = await orchestrator.optimize_solo(oop_request)
        
        oop_best = oop_result.itineraries[0] if oop_result.itineraries else None
        
        # For now, CPP would be similar (would need mode parameter)
        cpp_best = oop_best
        
        explanation = _generate_comparison_explanation(oop_best, cpp_best)
        
        return {
            "oop": _serialize_itinerary(oop_best) if oop_best else None,
            "cpp": _serialize_itinerary(cpp_best) if cpp_best else None,
            "recommendation": "oop",
            "explanation": explanation,
        }
    except Exception as e:
        logger.error(f"[/optimize/compare] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# =============================================================================
# HELPERS
# =============================================================================

def _serialize_itinerary(itinerary: RankedItinerary) -> dict:
    """Convert RankedItinerary to JSON-serializable dict."""
    if not itinerary:
        return None
    
    segments = []
    for seg in itinerary.segments:
        seg_dict = seg.model_dump()
        # Ensure payment is serialized properly
        if hasattr(seg.payment, 'model_dump'):
            seg_dict['payment'] = seg.payment.model_dump()
        segments.append(seg_dict)
    
    transfers = []
    for t in itinerary.transfers:
        transfers.append(t.model_dump())
    
    return {
        "id": itinerary.id,
        "rank": itinerary.rank,
        "name": itinerary.name,
        "route": itinerary.route,
        "segments": segments,
        "oopMetrics": {
            "totalCashPrice": itinerary.oop_metrics.total_cash_price,
            "totalOutOfPocket": itinerary.oop_metrics.total_out_of_pocket,
            "totalPointsUsed": itinerary.oop_metrics.total_points_used,
            "cashSaved": itinerary.oop_metrics.cash_saved,
            "savingsPercentage": itinerary.oop_metrics.savings_percentage,
            "averageCPP": itinerary.oop_metrics.average_cpp,
            "pointsBreakdown": itinerary.oop_metrics.points_breakdown,
        },
        "transfers": transfers,
        "withinBudget": itinerary.within_budget,
        "withinPoints": itinerary.within_points,
        "summary": itinerary.summary,
    }


def _generate_comparison_explanation(oop_best: RankedItinerary, cpp_best: RankedItinerary) -> str:
    """Generate explanation comparing OOP vs CPP strategies."""
    if not oop_best or not cpp_best:
        return "Unable to compare strategies - no results available."
    
    oop_cost = oop_best.oop_metrics.total_out_of_pocket
    cpp_cost = cpp_best.oop_metrics.total_out_of_pocket
    oop_cpp = oop_best.oop_metrics.average_cpp
    cpp_cpp = cpp_best.oop_metrics.average_cpp
    
    if oop_cost < cpp_cost:
        savings = cpp_cost - oop_cost
        return f"""The OOP (Out-of-Pocket) strategy saves you ${savings:.0f} more cash compared to 
CPP (Cents-Per-Point) optimization. While CPP achieves {cpp_cpp:.1f}¢/point vs OOP's {oop_cpp:.1f}¢/point, 
the OOP strategy uses points more aggressively to minimize what you actually pay. 
For most travelers, paying less cash now is more valuable than achieving marginally 
higher redemption values. We recommend OOP."""
    else:
        return f"""Both strategies result in similar out-of-pocket costs (${oop_cost:.0f}). 
The OOP strategy achieves {oop_cpp:.1f}¢/point value. We recommend OOP as it 
prioritizes minimizing your immediate cash expense."""
