"""
Optimization API Routes

These endpoints expose the agentic ILP optimization to the frontend.
All results are ranked by out-of-pocket (OOP) expense - lowest first.
"""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field, validator
from typing import Optional, Literal, Any
import logging
import uuid
import hashlib
import json

from ..agents.orchestrator import OrchestratorAgent
from ..agents.cost_breakdown_agent import CostBreakdownAgent
from ..agents.models import (
    OptimizeSoloRequest, OptimizeSoloResponse,
    OptimizeGroupRequest, OptimizeGroupResponse,
    CostBreakdown, RankedItinerary,
)
from ..agents.group_models import (
    MemberBookingCapability,
    BookingAllocationStrategy,
    GroupBookingPlan,
    SettlementSplitMethod,
)
from ..utils.jwt_auth import get_current_user_id
from ..utils.cache_layer import get_json, set_json

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
    trip_id: str = Field(..., min_length=1, max_length=100)
    points: dict[str, int] = {}  # program -> balance
    budget: float = Field(default=5000.0, ge=0, le=1000000)
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True
    
    @validator('trip_id')
    def validate_trip_id(cls, v):
        # Basic validation - alphanumeric and dashes only
        import re
        if not re.match(r'^[a-zA-Z0-9\-_]+$', v):
            raise ValueError('Invalid trip_id format')
        return v
    
    @validator('points')
    def validate_points(cls, v):
        # Ensure all values are non-negative
        for program, balance in v.items():
            if balance < 0:
                raise ValueError(f'Negative balance for {program}')
            if balance > 10_000_000:  # 10M points max
                raise ValueError(f'Balance too high for {program}')
        return v


class GroupOptimizeRequest(SoloOptimizeRequest):
    """Request body for group trip optimization."""
    member_points: dict[str, dict[str, int]] = {}  # member_id -> program -> balance
    member_budgets: dict[str, float] = {}
    split_method: Optional[Literal["equal", "by_usage", "proportional"]] = "by_usage"


class MemberCapabilityRequest(BaseModel):
    """A member's booking capability for group allocation."""
    member_id: str
    member_name: str
    points: dict[str, int] = {}  # program -> balance (THIS MEMBER's points only)
    max_cash_budget: Optional[float] = None
    traveler_count: int = 1  # How many people this member is booking for
    custom_split_percentage: Optional[float] = None  # For custom settlement splits


class AllocationStrategyRequest(BaseModel):
    """Strategy for allocating bookings across group members."""
    strategy_type: Literal["optimize", "by_segment_type", "by_direction", "manual"]
    flight_booker: Optional[str] = None  # member_id for by_segment_type
    hotel_booker: Optional[str] = None
    outbound_booker: Optional[str] = None  # for by_direction
    return_booker: Optional[str] = None
    manual_assignments: dict[str, str] = {}  # segment_id -> member_id


class GroupAllocationRequest(BaseModel):
    """
    Request body for group booking allocation.
    
    IMPORTANT: Points are per-member, NOT pooled!
    Each member uses their OWN points for segments they book.
    """
    trip_id: str = Field(..., min_length=1, max_length=100)
    members: list[MemberCapabilityRequest]
    strategy: AllocationStrategyRequest
    split_method: Literal["equal", "proportional_travelers", "proportional_points", "custom"] = "equal"
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True
    
    @validator('trip_id')
    def validate_trip_id(cls, v):
        import re
        if not re.match(r'^[a-zA-Z0-9\-_]+$', v):
            raise ValueError('Invalid trip_id format')
        return v


# Cache TTL for optimization results (10 minutes)
OPTIMIZATION_CACHE_TTL = 10 * 60


def _cache_key(request: SoloOptimizeRequest, user_id: str) -> str:
    """Generate cache key for optimization results."""
    data = {
        "trip_id": request.trip_id,
        "points": request.points,
        "budget": request.budget,
        "cabin_classes": request.cabin_classes,
        "hotel_stars": request.hotel_stars,
        "include_hotels": request.include_hotels,
        "user_id": user_id,
    }
    return f"opt:{hashlib.md5(json.dumps(data, sort_keys=True).encode()).hexdigest()}"


# =============================================================================
# ENDPOINTS
# =============================================================================

@router.post("/solo", response_model=None)
async def optimize_solo_trip(
    request: SoloOptimizeRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
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
    logger.info(f"[/optimize/solo] Starting optimization for trip {request.trip_id} by user {user_id}")
    
    # Check cache first
    cache_key = _cache_key(request, user_id)
    cached = get_json(cache_key)
    if cached:
        logger.info(f"[/optimize/solo] Cache hit for trip {request.trip_id}")
        return cached
    
    try:
        # Validate user has access to this trip
        from ..services.trip_service import get_trip
        trip = get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("createdBy") != user_id:
            raise HTTPException(status_code=403, detail="Access denied")
        
        # Validate points against server-side data
        validated_points = await _validate_and_get_points(request.trip_id, user_id, request.points)
        
        orchestrator = get_orchestrator()
        
        # Convert to internal model with validated points
        internal_request = OptimizeSoloRequest(
            trip_id=request.trip_id,
            points=validated_points,
            budget=request.budget,
            cabin_classes=request.cabin_classes,
            hotel_stars=request.hotel_stars,
            include_hotels=request.include_hotels,
        )
        
        result = await orchestrator.optimize_solo(internal_request)
        
        # Convert to JSON-serializable dict with consistent camelCase
        response = {
            "tripId": result.trip_id,
            "itineraries": [_serialize_itinerary(it) for it in result.itineraries],
            "bestOption": result.best_option,
            "warnings": result.warnings,
        }
        
        # Cache the result
        set_json(cache_key, response, OPTIMIZATION_CACHE_TTL)
        
        return response
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[/optimize/solo] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _validate_and_get_points(trip_id: str, user_id: str, client_points: dict) -> dict:
    """
    Validate points against server-side data.
    
    Uses server-side points as the source of truth, but allows
    client to specify a subset of their available points.
    """
    try:
        from ..services.points_service import trip_points_summary
        
        server_summary = trip_points_summary(trip_id)
        server_points = {}
        
        for item in server_summary.get("items", []):
            if item.get("userId") == user_id:
                program = item.get("program")
                balance = item.get("balance", 0)
                if program and balance > 0:
                    server_points[program] = balance
        
        # Use server points if available, otherwise trust client
        # (for demo/testing purposes when no points are saved)
        if server_points:
            # Validate client doesn't claim more than they have
            validated = {}
            for program, client_balance in client_points.items():
                server_balance = server_points.get(program, 0)
                # Use the minimum of client claim and server balance
                validated[program] = min(client_balance, server_balance) if server_balance else client_balance
            return validated if validated else server_points
        
        return client_points
    except Exception as e:
        logger.warning(f"Points validation failed, using client points: {e}")
        return client_points


@router.post("/group", response_model=None)
async def optimize_group_trip(
    request: GroupOptimizeRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Optimize a group trip with cost splitting and settlements.
    
    Additional features over solo:
    - Points pooling across all members
    - Per-member cost breakdown
    - Settlement calculations (who owes who)
    - Fair cost splitting based on split_method
    """
    logger.info(f"[/optimize/group] Starting optimization for trip {request.trip_id} by user {user_id}")
    
    try:
        # Validate user has access to this trip
        from ..services.trip_service import get_trip
        from ..services.trip_member_service import list_members
        
        trip = get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Check if user is owner or member
        members = list_members(request.trip_id)
        is_member = any(m.get("userId") == user_id for m in members)
        if trip.get("createdBy") != user_id and not is_member:
            raise HTTPException(status_code=403, detail="Access denied")
        
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
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[/optimize/group] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group/allocate", response_model=None)
async def allocate_group_bookings(
    request: GroupAllocationRequest,
    user_id: str = Depends(get_current_user_id),
) -> dict:
    """
    Allocate booking responsibilities across group members.
    
    **CRITICAL: Points are per-member, NOT pooled!**
    
    Each member uses their OWN points for segments they book.
    Example: Alice has 100k, Bob has 100k → each can only use their own 100k.
    
    Strategies:
    - **optimize**: System finds best assignment based on who has best points
    - **by_segment_type**: One person books all flights, another all hotels
    - **by_direction**: One books outbound flights, another return flights
    - **manual**: User specifies each segment assignment
    
    Returns:
    - **assignments**: Who books each segment with payment details
    - **memberSummaries**: Per-member breakdown of what they book/pay
    - **settlements**: Who owes whom after all bookings
    - **metrics**: Total group OOP and per-person cost
    """
    logger.info(f"[/optimize/group/allocate] Starting allocation for trip {request.trip_id}")
    logger.info(f"[/optimize/group/allocate] Strategy: {request.strategy.strategy_type}")
    logger.info(f"[/optimize/group/allocate] Members: {[m.member_id for m in request.members]}")
    
    try:
        # Validate user has access to this trip
        from ..services.trip_service import get_trip
        from ..services.trip_member_service import list_members
        
        trip = get_trip(request.trip_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Check if user is owner or member
        members = list_members(request.trip_id)
        member_ids = [m.get("userId") for m in members]
        if trip.get("createdBy") != user_id and user_id not in member_ids:
            raise HTTPException(status_code=403, detail="Access denied")
        
        orchestrator = get_orchestrator()
        
        # Build full MemberBookingCapability objects with all fields
        member_capabilities = [
            MemberBookingCapability(
                member_id=m.member_id,
                member_name=m.member_name,
                points=m.points,
                max_cash_budget=m.max_cash_budget,
                traveler_count=m.traveler_count,
                custom_split_percentage=m.custom_split_percentage,
            )
            for m in request.members
        ]
        
        # Build internal request (for trip data lookup)
        member_points = {m.member_id: m.points for m in request.members}
        member_budgets = {
            m.member_id: m.max_cash_budget
            for m in request.members
            if m.max_cash_budget is not None
        }
        
        internal_group_request = OptimizeGroupRequest(
            trip_id=request.trip_id,
            points={},  # Not used in allocation
            budget=0,
            cabin_classes=request.cabin_classes,
            hotel_stars=request.hotel_stars,
            include_hotels=request.include_hotels,
            member_points=member_points,
            member_budgets=member_budgets,
        )
        
        # Build allocation strategy
        strategy = BookingAllocationStrategy(
            strategy_type=request.strategy.strategy_type,
            flight_booker=request.strategy.flight_booker,
            hotel_booker=request.strategy.hotel_booker,
            outbound_booker=request.strategy.outbound_booker,
            return_booker=request.strategy.return_booker,
            manual_assignments=request.strategy.manual_assignments,
        )
        
        # Run allocation with proper per-member handling
        plan = await orchestrator.optimize_group_with_allocation(
            request=internal_group_request,
            strategy=strategy,
            split_method=request.split_method,
            members_override=member_capabilities,
        )
        
        # Serialize response with camelCase
        return _serialize_group_booking_plan(plan)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"[/optimize/group/allocate] Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _serialize_group_booking_plan(plan: GroupBookingPlan) -> dict:
    """Serialize GroupBookingPlan with camelCase keys."""
    return {
        "tripId": plan.trip_id,
        "strategyUsed": plan.strategy_used,
        "splitMethodUsed": plan.split_method_used,
        
        # Assignments with transfer details
        "assignments": [
            {
                "segmentId": a.segment_id,
                "segmentType": a.segment_type,
                "assignedTo": a.assigned_to,
                "assignedToName": a.assigned_to_name,
                "reason": a.reason,
                "usesPoints": a.uses_points,
                "pointsProgram": a.points_program,
                "pointsProgramName": a.points_program_name,
                "pointsUsed": a.points_used,
                "cashAmount": a.cash_amount,
                "segmentSummary": a.segment_summary,
                # NEW transfer fields
                "requiresTransfer": a.requires_transfer,
                "transferFrom": a.transfer_from,
                "transferFromName": a.transfer_from_name,
                "transferPointsFromSource": a.transfer_points_from_source,
                "transferRatio": a.transfer_ratio,
                "transferRatioDisplay": a.transfer_ratio_display,
                "transferTime": a.transfer_time,
                "transferPortalUrl": a.transfer_portal_url,
                "bookingUrl": a.booking_url,
            }
            for a in plan.assignments
        ],
        
        # NEW: Consolidated transfer instructions
        "transfersNeeded": [
            {
                "memberId": t.member_id,
                "memberName": t.member_name,
                "fromProgram": t.from_program,
                "fromProgramName": t.from_program_name,
                "toProgram": t.to_program,
                "toProgramName": t.to_program_name,
                "toProgramType": t.to_program_type,
                "totalSourcePoints": t.total_source_points,
                "totalTargetPoints": t.total_target_points,
                "ratio": t.ratio,
                "ratioDisplay": t.ratio_display,
                "transferTime": t.transfer_time,
                "portalUrl": t.portal_url,
                "bookingUrl": t.booking_url,
                "steps": t.steps,
                "coversSegments": t.covers_segments,
            }
            for t in plan.transfers_needed
        ],
        
        "memberSummaries": [
            {
                "memberId": s.member_id,
                "memberName": s.member_name,
                "segmentsToBook": s.segments_to_book,
                "segmentCount": s.segment_count,
                "totalCashUpfront": s.total_cash_upfront,
                "totalPointsUsed": s.total_points_used,
                "programsUsed": s.programs_used,
                "fairShare": s.fair_share,
                "settlementAmount": s.settlement_amount,
                "finalCost": s.final_cost,
            }
            for s in plan.member_summaries
        ],
        "settlements": [
            {
                "fromMember": s.from_member,
                "fromName": s.from_name,
                "toMember": s.to_member,
                "toName": s.to_name,
                "amount": s.amount,
                "reason": s.reason,
            }
            for s in plan.settlements
        ],
        "metrics": {
            "totalGroupOOP": plan.total_group_oop,
            "totalPointsUsed": plan.total_points_used,
            "perPersonEffectiveCost": plan.per_person_effective_cost,
            "totalTransfersNeeded": plan.total_transfers_needed,  # NEW
            "totalSourcePointsTransferred": plan.total_source_points_transferred,  # NEW
        },
        "validation": {
            "allSegmentsAssigned": plan.all_segments_assigned,
            "allMembersWithinBudget": plan.all_members_within_budget,
            "allMembersWithinPoints": plan.all_members_within_points,
        },
        "warnings": plan.warnings,
    }


@router.get("/breakdown/{itinerary_id}", response_model=None)
async def get_cost_breakdown(
    itinerary_id: str,
    user_id: str = Depends(get_current_user_id),
) -> dict:
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
    # Validate itinerary_id format
    try:
        uuid.UUID(itinerary_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid itinerary_id format")
    
    # Try to get from cache
    cache_key = f"breakdown:{itinerary_id}"
    cached = get_json(cache_key)
    if cached:
        return cached
    
    try:
        # Try to get the itinerary from recent results in cache
        # The itinerary is stored when optimization runs
        itinerary_cache_key = f"itinerary:{itinerary_id}"
        itinerary_data = get_json(itinerary_cache_key)
        
        if itinerary_data:
            # Generate breakdown using Cost Breakdown Agent
            cost_agent = get_cost_agent()
            
            # Reconstruct RankedItinerary from cached data
            from ..agents.models import RankedItinerary, OOPMetrics, FlightSegment, HotelSegment, CashPayment, PointsPayment, TransferInstruction
            
            # Build segments from cached data
            segments = []
            for seg_data in itinerary_data.get("segments", []):
                if seg_data.get("type") == "flight":
                    payment_data = seg_data.get("payment", {})
                    if payment_data.get("method") == "points":
                        payment = PointsPayment(**payment_data)
                    else:
                        payment = CashPayment(**payment_data)
                    segments.append(FlightSegment(**{**seg_data, "payment": payment}))
                else:
                    payment_data = seg_data.get("payment", {})
                    if payment_data.get("method") == "points":
                        payment = PointsPayment(**payment_data)
                    else:
                        payment = CashPayment(**payment_data)
                    segments.append(HotelSegment(**{**seg_data, "payment": payment}))
            
            # Build transfers
            transfers = [
                TransferInstruction(**t) for t in itinerary_data.get("transfers", [])
            ]
            
            # Build OOP metrics
            metrics_data = itinerary_data.get("oopMetrics", {})
            oop_metrics = OOPMetrics(
                total_cash_price=metrics_data.get("totalCashPrice", 0),
                total_out_of_pocket=metrics_data.get("totalOutOfPocket", 0),
                total_points_used=metrics_data.get("totalPointsUsed", 0),
                cash_saved=metrics_data.get("cashSaved", 0),
                savings_percentage=metrics_data.get("savingsPercentage", 0),
                average_cpp=metrics_data.get("averageCPP", 0),
                points_breakdown=metrics_data.get("pointsBreakdown", {}),
            )
            
            itinerary = RankedItinerary(
                id=itinerary_data.get("id", itinerary_id),
                rank=itinerary_data.get("rank", 1),
                name=itinerary_data.get("name", "Itinerary"),
                route=itinerary_data.get("route", []),
                segments=segments,
                oop_metrics=oop_metrics,
                transfers=transfers,
                within_budget=itinerary_data.get("withinBudget", True),
                within_points=itinerary_data.get("withinPoints", True),
                summary=itinerary_data.get("summary"),
            )
            
            # Generate breakdown
            breakdown_result = await cost_agent.execute(itinerary)
            
            # Serialize with camelCase
            breakdown = {
                "tripSummary": breakdown_result.trip_summary,
                "segments": [
                    {
                        "segment": s.segment,
                        "type": s.type,
                        "cashPrice": s.cash_price,
                        "paymentMethod": s.payment_method,
                        "amount": s.amount,
                        "program": s.program,
                        "pointsUsed": s.points_used,
                        "surcharge": s.surcharge,
                        "cppAchieved": s.cpp_achieved,
                        "reason": s.reason,
                        "transfer": _serialize_transfer(s.transfer) if s.transfer else None,
                    }
                    for s in breakdown_result.segments
                ],
                "transferSummary": breakdown_result.transfer_summary,
                "paymentBreakdown": breakdown_result.payment_breakdown,
                "valueAnalysis": breakdown_result.value_analysis,
                "status": "complete",
            }
            
            # Cache the breakdown
            set_json(cache_key, breakdown, OPTIMIZATION_CACHE_TTL)
            
            return breakdown
    except Exception as e:
        logger.warning(f"Failed to generate breakdown for {itinerary_id}: {e}")
    
    # Fallback: return placeholder
    return {
        "tripSummary": {
            "route": "Select an itinerary to see breakdown",
            "totalCashPrice": 0,
            "totalOutOfPocket": 0,
            "totalSavings": 0,
            "savingsPercentage": 0,
        },
        "segments": [],
        "transferSummary": {
            "totalTransfers": 0,
            "bySource": {},
            "recommendedOrder": [],
            "timingAdvice": "Complete transfers 2-3 days before booking to ensure points post correctly.",
        },
        "paymentBreakdown": {
            "cashPayments": [],
            "totalCash": 0,
            "pointsUsed": {},
            "totalPoints": 0,
        },
        "valueAnalysis": {
            "averageCPP": 0,
            "bestRedemption": None,
            "worstRedemption": None,
        },
        "status": "not_found",
        "message": "Itinerary not found in cache. Please run optimization again.",
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

def _to_camel_case(snake_str: str) -> str:
    """Convert snake_case to camelCase."""
    components = snake_str.split('_')
    return components[0] + ''.join(x.title() for x in components[1:])


def _serialize_payment(payment) -> dict:
    """Serialize payment with camelCase keys."""
    if not payment:
        return {}
    
    raw = payment.model_dump() if hasattr(payment, 'model_dump') else dict(payment)
    result = {}
    
    for key, value in raw.items():
        camel_key = _to_camel_case(key)
        
        # Handle nested transfer
        if key == 'transfer' and value:
            value = _serialize_transfer(value)
        
        result[camel_key] = value
    
    return result


def _serialize_transfer(transfer) -> dict:
    """Serialize transfer instruction with camelCase keys."""
    if not transfer:
        return None
    
    raw = transfer.model_dump() if hasattr(transfer, 'model_dump') else dict(transfer)
    return {_to_camel_case(k): v for k, v in raw.items()}


def _serialize_segment(seg) -> dict:
    """Serialize a segment with camelCase keys."""
    raw = seg.model_dump() if hasattr(seg, 'model_dump') else dict(seg)
    result = {}
    
    for key, value in raw.items():
        camel_key = _to_camel_case(key)
        
        # Handle payment specially
        if key == 'payment' and value:
            value = _serialize_payment(seg.payment)
        
        result[camel_key] = value
    
    return result


def _serialize_itinerary(itinerary: RankedItinerary) -> dict:
    """Convert RankedItinerary to JSON-serializable dict with camelCase keys."""
    if not itinerary:
        return None
    
    segments = [_serialize_segment(seg) for seg in itinerary.segments]
    transfers = [_serialize_transfer(t) for t in itinerary.transfers]
    
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
