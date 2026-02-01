"""
Solo Booking Routes

This module contains all API endpoints for the solo booking flow.
All responses use snake_case; frontend converts to camelCase via serializers.

Integrates with the real OrchestratorAgent for ILP-based optimization.
"""
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException

from ..utils.jwt_auth import get_current_user_id
from ..schemas import (
    # Trip schemas
    CreateTripRequest as SoloCreateTripRequest,
    TripResponse,
    UpdateTripStatusRequest,
    StatusUpdateResponse,
    SelectItineraryRequest,
    SelectionResponse,
    # Points schemas
    UpsertPointsRequest as SoloUpsertPointsRequest,
    PointsSummaryResponse,
    # Optimize schemas
    OptimizeSoloRequest,
    OptimizeSoloResponse,
    TransferStrategyRequest,
    TransferStrategyResponse,
    TransferInsight,
    TransferInstruction,
    SegmentBreakdown,
    OOPMetrics,
    RankedItinerary,
    BookingStep,
)
from ..services import solo_trip_service
from ..mappers.trip_mapper import trip_storage_to_response

# Import the real orchestrator
from ..agents.orchestrator import OrchestratorAgent
from ..agents.models import OptimizeSoloRequest as AgentOptimizeSoloRequest

# Import transfer validation
from ..handlers.transfer_strategy import EXTENDED_TRANSFER_GRAPH, PROGRAM_METADATA, BANK_METADATA
from ..solo.snapshot_schema import normalize_snapshot, validate_snapshot

logger = logging.getLogger(__name__)


def _is_valid_transfer(bank: str, program: str) -> bool:
    """Check if a bank can transfer to a specific airline/hotel program."""
    bank_lower = bank.lower().replace("_", "").replace(" ", "")
    
    # Normalize bank names
    bank_map = {
        "amexmr": "amex", "amexmembershiprewards": "amex", "membershiprewards": "amex",
        "chaseur": "chase", "chaseultimaterewards": "chase", "ultimaterewards": "chase",
        "citityp": "citi", "citithankyou": "citi", "thankyoupoints": "citi",
        "capitalone": "capitalone", "capitaloneventurex": "capitalone",
        "bilt": "bilt", "biltrewards": "bilt",
    }
    bank_normalized = bank_map.get(bank_lower, bank_lower)
    
    # Normalize program codes (optimization uses full names, transfer graph uses codes)
    prog_lower = program.lower().replace("_", "").replace(" ", "") if program else ""
    prog_map = {
        "marriott": "MAR", "marriottbonvoy": "MAR", "bonvoy": "MAR",
        "hilton": "HH", "hiltonhonors": "HH",
        "hyatt": "HYATT", "worldofhyatt": "HYATT",
        "ihg": "IHG", "ihgonerewards": "IHG",
        "delta": "DL", "deltaskymiles": "DL",
        "united": "UA", "unitedmileageplus": "UA",
        "american": "AA", "americanadvantage": "AA", "aadvantage": "AA",
        "britishairways": "BA", "avios": "BA",
        "airfrance": "AF", "flyingblue": "AF", "airfranceklm": "AF",
        "singapore": "SQ", "krisflyer": "SQ",
        "virgin": "VS", "virginatlantic": "VS",
        "alaska": "AS", "alaskaairlines": "AS",
        "jetblue": "B6", "trueblue": "B6",
        "southwest": "WN", "rapidrewards": "WN",
        "ana": "NH", "anamileageclub": "NH",
        "emirates": "EK", "skywards": "EK",
        "cathay": "CX", "asiamiles": "CX",
        "qantas": "QF", "frequentflyer": "QF",
        "avianca": "AV", "lifemiles": "AV",
        "iberia": "IB", "iberiaplus": "IB",
        "etihad": "EY", "etihadguest": "EY",
    }
    prog_normalized = prog_map.get(prog_lower, program.upper() if program else "")
    
    # Check if this transfer is valid
    if bank_normalized not in EXTENDED_TRANSFER_GRAPH:
        return False
    
    return prog_normalized in EXTENDED_TRANSFER_GRAPH[bank_normalized]


def _get_program_display_name(program: str) -> str:
    """Get human-readable name for a program."""
    meta = PROGRAM_METADATA.get(program.upper(), {})
    return meta.get("name", program)


def _get_bank_display_name(bank: str) -> str:
    """Get human-readable name for a bank."""
    bank_lower = bank.lower().replace("_", "")
    bank_map = {"amexmr": "amex", "chaseur": "chase", "citityp": "citi"}
    normalized = bank_map.get(bank_lower, bank_lower)
    meta = BANK_METADATA.get(normalized, {})
    return meta.get("name", bank)

# Singleton orchestrator
_orchestrator: Optional[OrchestratorAgent] = None


def get_orchestrator() -> OrchestratorAgent:
    """Get or create the orchestrator agent (singleton)."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = OrchestratorAgent()
    return _orchestrator

router = APIRouter(prefix="/solo", tags=["Solo Booking"])


# ============================================================================
# Trip Endpoints
# ============================================================================

@router.post("/trips", response_model=TripResponse)
async def create_solo_trip(
    request: SoloCreateTripRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Create a new solo trip.
    
    This endpoint creates a trip with:
    - Origin and destinations (IATA codes)
    - Trip type (one_way/round_trip)
    - Date mode (fixed/flexible)
    - Preferences (flight class, hotel class, etc.)
    """
    try:
        trip = solo_trip_service.create_solo_trip(user_id, request)
        # Convert camelCase storage to snake_case API response
        return trip_storage_to_response(trip)
    except Exception as e:
        logger.error(f"Error creating solo trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trips/{trip_id}", response_model=TripResponse)
async def get_solo_trip(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get a solo trip by ID."""
    try:
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        # Convert camelCase storage to snake_case API response
        return trip_storage_to_response(trip)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting solo trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/status", response_model=StatusUpdateResponse)
async def update_solo_trip_status(
    trip_id: str,
    request: UpdateTripStatusRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Update trip status.
    
    Status lifecycle: draft → optimized → selected → instructions_unlocked → completed
    """
    try:
        result = solo_trip_service.update_solo_trip_status(
            trip_id, 
            request.status, 
            user_id,
            request.payment_proof
        )
        return result
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating trip status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/select", response_model=SelectionResponse)
async def select_itinerary(
    trip_id: str,
    request: SelectItineraryRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Select an itinerary for booking.
    
    P1-2: Stores full itinerary snapshot for reproducibility (award availability changes).
    """
    try:
        logger.info(f"[select_itinerary] trip_id={trip_id}, itinerary_id={request.itinerary_id}")
        snapshot = request.itinerary_snapshot or {}
        if isinstance(snapshot, dict):
            transfers = snapshot.get('transfers', [])
            logger.info(f"[select_itinerary] Snapshot has {len(transfers)} transfers")
        result = solo_trip_service.select_itinerary(trip_id, user_id, request)
        logger.info(f"[select_itinerary] Selection saved successfully")
        return result
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error selecting itinerary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trips/{trip_id}/selection", response_model=SelectionResponse)
async def get_selection(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get the selected itinerary snapshot for a trip.
    
    Returns the itinerary that was selected, including the full snapshot.
    If no selection exists, returns ok=True with null fields (not 404).
    """
    try:
        selection = solo_trip_service.get_selection(trip_id, user_id)
        if not selection:
            # Return empty selection instead of 404 - easier for frontend to handle
            logger.info(f"[get_selection] trip_id={trip_id}: No selection found")
            return SelectionResponse(ok=True)
        
        snapshot = selection.get('itinerary_snapshot', {})
        if isinstance(snapshot, dict):
            transfers = snapshot.get('transfers', [])
            logger.info(f"[get_selection] trip_id={trip_id}: Found selection with {len(transfers)} transfers")
        else:
            logger.info(f"[get_selection] trip_id={trip_id}: Found selection, snapshot type={type(snapshot)}")
        
        # Remove 'ok' from selection if it exists (to avoid duplicate keyword arg)
        selection_data = {k: v for k, v in selection.items() if k != 'ok'}
        return SelectionResponse(ok=True, **selection_data)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting selection: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Points Endpoints
# ============================================================================

@router.get("/trips/{trip_id}/points", response_model=PointsSummaryResponse)
async def get_trip_points(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """Get points balances for a trip."""
    try:
        return solo_trip_service.get_points(trip_id, user_id)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting trip points: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/points", response_model=PointsSummaryResponse)
async def upsert_trip_points(
    trip_id: str,
    request: SoloUpsertPointsRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Upsert points balances for a trip.
    
    Issue #3 FIX: use request.points (matches UpsertPointsRequest schema)
    """
    try:
        return solo_trip_service.upsert_points(trip_id, user_id, request.points)
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error upserting trip points: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Optimization Endpoints
# ============================================================================

@router.post("/optimize", response_model=OptimizeSoloResponse)
async def optimize_solo(
    request: OptimizeSoloRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Optimize a solo trip using the real ILP-based orchestrator.
    
    Fixup 3: Uses trip preferences from backend (source of truth).
    Only tripId + points + optional mode override come from request.
    """
    try:
        # Get trip to load preferences
        trip = solo_trip_service.get_solo_trip(request.trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Resolve mode: override takes precedence, else trip setting
        mode = request.optimization_mode_override or trip.get("optimizationMode", "balanced")
        
        # Check cache
        cache_key = solo_trip_service.compute_cache_key(
            request.trip_id, 
            trip, 
            request.points, 
            mode
        )
        
        cached = solo_trip_service.get_cached_optimization(request.trip_id, cache_key)
        if cached and not solo_trip_service.is_cache_expired(cached):
            # Return cached result with proper response model
            return _build_response_from_cached(cached)
        
        # Run REAL optimization using the orchestrator
        orchestrator = get_orchestrator()
        
        # Build the agent request with trip preferences
        # Budget from trip, or default high to not constrain
        budget = trip.get("max_budget") or 50000.0
        
        # Map cabin class preference (use camelCase field names)
        cabin_classes = _map_flight_class(trip.get("flightClass", "economy"))
        hotel_stars = _map_hotel_class(trip.get("hotelClass", "4"))
        
        agent_request = AgentOptimizeSoloRequest(
            trip_id=request.trip_id,
            points=request.points,
            budget=budget,
            cabin_classes=cabin_classes,
            hotel_stars=hotel_stars,
            include_hotels=trip.get("includeHotels", True),
        )
        
        logger.info(f"[solo/optimize] Running orchestrator for trip {request.trip_id} with mode {mode}")
        
        # Call the real orchestrator
        agent_response = await orchestrator.optimize_solo(agent_request)
        
        # Transform to our response schema
        now = datetime.now(timezone.utc)
        expires = now + timedelta(hours=solo_trip_service.OPTIMIZATION_CACHE_TTL_HOURS)
        computed_str = now.strftime('%Y-%m-%dT%H:%M:%SZ')
        expires_str = expires.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Convert agent itineraries to our schema format
        itineraries = _transform_itineraries(agent_response.itineraries)
        
        # Generate insights from the results
        global_insights = _generate_insights(itineraries) if itineraries else []
        
        result = {
            "itineraries": [it.model_dump() for it in itineraries],
            "best_option": itineraries[0].id if itineraries else None,
            "warnings": agent_response.warnings or [],
            "global_insights": [i.model_dump() for i in global_insights],
            "risk_mode": "balanced",
        }
        
        # Cache the result
        solo_trip_service.cache_optimization(
            trip_id=request.trip_id,
            cache_key=cache_key,
            result=result,
            computed_at=computed_str,
            expires_at=expires_str,
            ttl_epoch=int(expires.timestamp()),
        )
        
        # Update trip status to optimized
        try:
            solo_trip_service.update_solo_trip_status(request.trip_id, "optimized", user_id)
        except Exception as e:
            logger.warning(f"Failed to update trip status: {e}")
        
        return OptimizeSoloResponse(
            itineraries=itineraries,
            best_option=itineraries[0].id if itineraries else None,
            warnings=agent_response.warnings or [],
            global_insights=global_insights,
            risk_mode="balanced",
            cached=False,
            computed_at=computed_str,
            expires_at=expires_str,
        )
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error optimizing solo trip: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


def _map_flight_class(flight_class: str) -> list[str]:
    """Map trip flight_class preference to orchestrator cabin classes."""
    mapping = {
        "basic_economy": ["Economy"],
        "economy": ["Economy"],
        "premium": ["Premium Economy", "Business"],
        "business": ["Business"],
        "first": ["First", "Business"],
    }
    return mapping.get(flight_class, ["Economy", "Business"])


def _map_hotel_class(hotel_class: str) -> list[int]:
    """Map trip hotel_class preference to star ratings."""
    mapping = {
        "3": [3, 4],
        "4": [4, 5],
        "5": [5],
    }
    return mapping.get(hotel_class, [4, 5])


def _transform_itineraries(agent_itineraries: list) -> list[RankedItinerary]:
    """Transform orchestrator itineraries to our schema format."""
    result = []
    
    for agent_it in agent_itineraries:
        # Build segments from agent segments
        segments = []
        for seg in agent_it.segments:
            seg_type = "flight" if hasattr(seg, 'airline') else "hotel"
            
            # Determine payment method and extract details
            payment = seg.payment
            if hasattr(payment, 'method') and payment.method == 'points':
                payment_method = "points"
                points_used = getattr(payment, 'points_used', None) or getattr(payment, 'pointsUsed', 0)
                surcharge = getattr(payment, 'surcharge', 0)
                cpp = getattr(payment, 'cpp_achieved', None) or getattr(payment, 'cppAchieved', 0)
                transfer_from = None
                transfer_to = None
                if hasattr(payment, 'transfer') and payment.transfer:
                    transfer_from = payment.transfer.from_program
                    transfer_to = payment.transfer.to_program
            else:
                payment_method = "cash"
                points_used = None
                surcharge = None
                cpp = None
                transfer_from = None
                transfer_to = None
            
            # Build segment with full details
            if seg_type == "flight":
                segment_name = f"{seg.origin} → {seg.destination}"
                cash_price = seg.cash_price or 0
                program = getattr(payment, 'program', None) if payment_method == "points" else None
                
                segments.append(SegmentBreakdown(
                    segment=segment_name,
                    type=seg_type,
                    payment_method=payment_method,
                    cash_price=cash_price,
                    points_used=points_used,
                    surcharge=surcharge,
                    cpp_achieved=cpp,
                    transfer_from=transfer_from,
                    transfer_to=transfer_to,
                    program=program,
                    # Flight-specific details
                    origin=seg.origin,
                    destination=seg.destination,
                    departure_time=getattr(seg, 'departure_time', None),
                    arrival_time=getattr(seg, 'arrival_time', None),
                    airline=getattr(seg, 'airline', None),
                    operating_airline=getattr(seg, 'operating_airline', None),
                    flight_number=getattr(seg, 'flight_numbers', [''])[0] if getattr(seg, 'flight_numbers', None) else getattr(seg, 'flight_number', None),
                    cabin_class=getattr(seg, 'cabin_class', None),
                    duration_minutes=getattr(seg, 'duration_minutes', None),
                    booking_url=getattr(seg, 'booking_url', None),
                ))
            else:
                segment_name = f"{seg.name} ({seg.city})"
                cash_price = getattr(seg, 'cash_price_total', 0) or getattr(seg, 'cashPriceTotal', 0)
                program = getattr(payment, 'program', None) if payment_method == "points" else None
                
                segments.append(SegmentBreakdown(
                    segment=segment_name,
                    type=seg_type,
                    payment_method=payment_method,
                    cash_price=cash_price,
                    points_used=points_used,
                    surcharge=surcharge,
                    cpp_achieved=cpp,
                    transfer_from=transfer_from,
                    transfer_to=transfer_to,
                    program=program,
                    # Hotel-specific details
                    hotel_name=getattr(seg, 'name', None),
                    brand=getattr(seg, 'brand', None),
                    city=getattr(seg, 'city', None),
                    check_in=getattr(seg, 'check_in', None),
                    check_out=getattr(seg, 'check_out', None),
                    nights=getattr(seg, 'nights', None),
                    booking_url=getattr(seg, 'booking_url', None),
                ))
        
        # Build transfers
        transfers = []
        for idx, t in enumerate(agent_it.transfers or []):
            transfers.append(TransferInstruction(
                step_number=idx + 1,
                source_program=t.from_program,
                target_program=t.to_program,
                points_to_transfer=t.points_to_transfer,
                transfer_ratio=t.ratio,
                expected_transfer_time=t.transfer_time,
                portal_url=t.portal_url,
                warning=t.warning,
            ))
        
        # Build OOP metrics
        metrics = agent_it.oop_metrics
        oop_metrics = OOPMetrics(
            total_cash_price=metrics.total_cash_price,
            total_out_of_pocket=metrics.total_out_of_pocket,
            cash_saved=metrics.cash_saved,
            savings_percentage=metrics.savings_percentage,
            total_points_used=metrics.total_points_used,
            average_cpp=metrics.average_cpp,
        )
        
        # Build route from segments
        route = []
        for seg in agent_it.segments:
            if hasattr(seg, 'origin') and seg.origin not in route:
                route.append(seg.origin)
            if hasattr(seg, 'destination') and seg.destination not in route:
                route.append(seg.destination)
        
        display_name = agent_it.name or " → ".join(route) if route else "Itinerary"

        # Preserve policy evaluation fields if present on agent itinerary (V3 adapter attaches these)
        policy_eval = getattr(agent_it, "policy_evaluation", None)
        disabled = getattr(agent_it, "disabled", None)
        disable_reason = getattr(agent_it, "disable_reason", None)
        if policy_eval is not None and hasattr(policy_eval, "model_dump"):
            policy_eval = policy_eval.model_dump()
        
        result.append(RankedItinerary(
            id=agent_it.id,
            rank=agent_it.rank,
            route=route,
            display_name=display_name,
            policy_evaluation=policy_eval,
            disabled=disabled,
            disable_reason=disable_reason,
            segments=segments,
            oop_metrics=oop_metrics,
            transfers=transfers,
            insights=[],  # Will be populated later
        ))
    
    return result


def _generate_insights(itineraries: list[RankedItinerary]) -> list[TransferInsight]:
    """Generate insights from optimization results."""
    insights = []
    
    if not itineraries:
        return insights
    
    best = itineraries[0]
    
    # Check for good CPP value
    if best.oop_metrics.average_cpp >= 1.5:
        insights.append(TransferInsight(
            type="sweet_spot",
            description=f"Achieving {best.oop_metrics.average_cpp:.1f}¢ per point - excellent value!",
            confidence="high",
        ))
    
    # Check for significant savings
    if best.oop_metrics.savings_percentage >= 30:
        insights.append(TransferInsight(
            type="cross_program",
            description=f"Saving {best.oop_metrics.savings_percentage:.0f}% vs cash price through points optimization",
            confidence="high",
        ))
    
    # Check for transfer opportunities
    if best.transfers:
        for t in best.transfers:
            if t.transfer_ratio > 1.0:
                insights.append(TransferInsight(
                    type="transfer_bonus",
                    description=f"Transfer bonus: {t.transfer_ratio:.0%} when moving points to {t.target_program}",
                    confidence="medium",
                ))
                break  # Only show one transfer bonus insight
    
    return insights


def _build_response_from_cached(cached: dict) -> OptimizeSoloResponse:
    """Build response from cached data."""
    result = cached.get("result", {})
    
    # Reconstruct itineraries from cached data
    itineraries = []
    for it_data in result.get("itineraries", []):
        itineraries.append(RankedItinerary(**it_data))
    
    global_insights = []
    for ins_data in result.get("global_insights", []):
        global_insights.append(TransferInsight(**ins_data))
    
    return OptimizeSoloResponse(
        itineraries=itineraries,
        best_option=result.get("best_option"),
        warnings=result.get("warnings", []),
        global_insights=global_insights,
        risk_mode=result.get("risk_mode"),
        cached=True,
        computed_at=cached.get("computed_at", ""),
        expires_at=cached.get("expires_at", ""),
    )


@router.get("/optimization-cache/{trip_id}", response_model=OptimizeSoloResponse)
async def get_optimization_cache(
    trip_id: str,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get cached optimization results for a trip.
    Returns 404 if no cache exists.
    """
    try:
        # Get trip to verify ownership
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Build cache key (simplified - assumes points haven't changed)
        points_summary = solo_trip_service.get_points(trip_id, user_id)
        points_dict = {p.program: p.balance for p in (points_summary.items or [])}
        
        # Use default mode for cache lookup
        mode = trip.get("optimizationMode", "balanced")
        cache_key = solo_trip_service.compute_cache_key(trip_id, trip, points_dict, mode)
        cached = solo_trip_service.get_cached_optimization(trip_id, cache_key)
        
        if not cached or solo_trip_service.is_cache_expired(cached):
            logger.info(f"[optimization-cache] No valid cache found for trip {trip_id}")
            raise HTTPException(status_code=404, detail="No cached optimization results")
        
        logger.info(f"[optimization-cache] Returning cached results for trip {trip_id}")
        return _build_response_from_cached(cached)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting optimization cache: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/transfer-strategy", response_model=TransferStrategyResponse)
async def get_transfer_strategy(
    request: TransferStrategyRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Get transfer strategy and booking instructions for a selected itinerary.
    Generates real booking steps from the itinerary snapshot.
    """
    try:
        # Enforce server-side unlock: do not return booking instructions until unlocked.
        trip = solo_trip_service.get_solo_trip(request.trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        if trip.get("status") != "instructions_unlocked":
            return TransferStrategyResponse(
                transfers=[],
                bookings=[],
                total_points_to_transfer=0,
                estimated_total_time="Locked",
                warnings=["Instructions locked. Complete payment to unlock transfer and booking steps."],
            )

        # Get selection to verify it exists
        selection = solo_trip_service.get_selection(request.trip_id, user_id)
        if not selection:
            raise HTTPException(status_code=404, detail="No selection found. Please select an itinerary first.")
        
        if selection.get("itinerary_id") != request.itinerary_id:
            raise HTTPException(status_code=400, detail="Itinerary ID does not match selection")
        
        # Extract itinerary snapshot
        snapshot = selection.get("itinerary_snapshot", {})
        snapshot = normalize_snapshot(snapshot)
        errors = validate_snapshot(snapshot)
        if errors:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Selection snapshot invalid; re-optimize and re-select.",
                    "errors": errors,
                },
            )
        
        # Debug: log what we received in the snapshot
        logger.info(f"[transfer-strategy] Snapshot keys: {list(snapshot.keys()) if snapshot else 'None'}")
        logger.info(f"[transfer-strategy] Snapshot transfers: {snapshot.get('transfers', 'NOT FOUND')}")
        
        # Generate transfer instructions from snapshot
        transfers = []
        bookings = []
        total_points = 0
        max_time_days = 0
        
        # Process transfers from snapshot - validate each one
        snapshot_transfers = snapshot.get("transfers", [])
        for idx, t in enumerate(snapshot_transfers):
            source = t.get("sourceProgram") or t.get("source_program") or t.get("fromProgram") or t.get("from_program", "")
            target = t.get("targetProgram") or t.get("target_program") or t.get("toProgram") or t.get("to_program", "")
            points_raw = t.get("pointsToTransfer") or t.get("points_to_transfer", 0)
            points = int(points_raw) if points_raw else 0  # Handle Decimal from DynamoDB
            ratio_raw = t.get("transferRatio") or t.get("transfer_ratio") or t.get("ratio", 1.0)
            ratio = float(ratio_raw) if ratio_raw else 1.0  # Handle Decimal from DynamoDB
            time_str = t.get("expectedTransferTime") or t.get("expected_transfer_time") or t.get("transferTime") or t.get("transfer_time", "instant")
            portal = t.get("portalUrl") or t.get("portal_url", "")
            warning = t.get("warning")
            
            # Validate transfer is possible
            if not _is_valid_transfer(source, target):
                source_name = _get_bank_display_name(source)
                target_name = _get_program_display_name(target)
                warning = f"⚠️ {source_name} cannot transfer directly to {target_name}. This may be a codeshare booking."
                logger.warning(f"[transfer-strategy] Invalid transfer: {source} -> {target}")
            
            # Skip invalid transfers with 0 points
            if points <= 0:
                continue
            
            transfers.append(TransferInstruction(
                step_number=idx + 1,
                source_program=source,
                target_program=target,
                points_to_transfer=points,
                transfer_ratio=ratio,
                expected_transfer_time=time_str,
                portal_url=portal,
                warning=warning,
            ))
            
            total_points += points
            
            # Parse time for estimate
            if "day" in time_str.lower():
                try:
                    days = int(''.join(filter(str.isdigit, time_str.split('-')[-1])))
                    max_time_days = max(max_time_days, days)
                except:
                    max_time_days = max(max_time_days, 2)
        
        # Generate booking steps from ALL segments (flights and hotels)
        segments = snapshot.get("segments", [])
        step_num = len(transfers) + 1
        
        logger.info(f"[transfer-strategy] Processing {len(segments)} segments")
        
        for seg in segments:
            logger.info(f"[transfer-strategy] Segment: type={seg.get('type')}, cashPrice={seg.get('cashPrice')}, pointsUsed={seg.get('pointsUsed')}, paymentMethod={seg.get('paymentMethod')}, program={seg.get('program')}, origin={seg.get('origin')}, destination={seg.get('destination')}, airline={seg.get('airline')}, departureTime={seg.get('departureTime')}")
            seg_type = seg.get("type", "flight")
            
            # Payment info can be in 'payment' object (old format) or directly in segment (new format)
            payment = seg.get("payment", {})
            payment_method_raw = seg.get("paymentMethod") or seg.get("payment_method") or payment.get("method") or payment.get("paymentMethod")
            payment_method = "points" if payment_method_raw == "points" else "cash"
            
            # Points/surcharge can be in payment object or directly in segment
            # Handle Decimal type from DynamoDB
            points_raw = seg.get("pointsUsed") or seg.get("points_used") or payment.get("pointsUsed") or payment.get("points_used", 0)
            points_used = int(points_raw) if points_raw else 0
            surcharge_raw = seg.get("surcharge") or payment.get("surcharge", 0)
            surcharge = float(surcharge_raw) if surcharge_raw else 0.0
            program = seg.get("program") or payment.get("program", "")
            
            if seg_type == "flight":
                airline = seg.get("airline", "Airline")
                origin = seg.get("origin", "")
                destination = seg.get("destination", "")
                cabin = seg.get("cabinClass") or seg.get("cabin_class") or seg.get("cabin", "Economy")
                departure = seg.get("departureTime") or seg.get("departure_time", "")
                arrival = seg.get("arrivalTime") or seg.get("arrival_time", "")
                flight_num = seg.get("flightNumber") or seg.get("flight_number", "")
                duration = seg.get("durationMinutes") or seg.get("duration_minutes")
                booking_url = seg.get("bookingUrl") or seg.get("booking_url", "")
                cash_price_raw = seg.get("cashPrice") or seg.get("cash_price", 0)
                cash_price = float(cash_price_raw) if cash_price_raw else 0.0  # Handle Decimal from DynamoDB
                operating_airline = seg.get("operatingAirline") or seg.get("operating_airline", "")
                
                # Build segment reference (simple - codeshare shown separately)
                segment_ref = f"{origin} → {destination} {cabin} on {airline}"
                
                # Build booking URL based on the program used for booking
                if not booking_url and program:
                    prog_meta = PROGRAM_METADATA.get(program.upper(), {})
                    booking_url = prog_meta.get("booking_url", f"https://{airline.lower().replace(' ', '')}.com")
                elif not booking_url:
                    booking_url = f"https://{airline.lower().replace(' ', '')}.com"
                
                # Ensure cash_price is valid (not 0 for cash bookings)
                display_cash_price = cash_price if cash_price and cash_price > 0 else None
                
                bookings.append(BookingStep(
                    step_number=step_num,
                    type="flight",
                    airline=airline,
                    booking_url=booking_url,
                    segment_reference=segment_ref,
                    origin=origin,
                    destination=destination,
                    departure_time=departure,
                    arrival_time=arrival,
                    cabin_class=cabin,
                    flight_number=flight_num,
                    operating_airline=operating_airline if operating_airline and operating_airline != airline else None,
                    duration_minutes=duration,
                    payment_method=payment_method,
                    points_used=points_used if payment_method == "points" else None,
                    cash_price=display_cash_price,
                    surcharge=surcharge if payment_method == "points" else None,
                    program=program if payment_method == "points" else None,
                ))
            else:
                hotel_name = seg.get("hotelName") or seg.get("hotel_name") or seg.get("name", "Hotel")
                brand = seg.get("brand", "")
                city = seg.get("city", "")
                check_in = seg.get("checkIn") or seg.get("check_in", "")
                check_out = seg.get("checkOut") or seg.get("check_out", "")
                nights_raw = seg.get("nights", 0)
                nights = int(nights_raw) if nights_raw else 0  # Handle Decimal from DynamoDB
                booking_url = seg.get("bookingUrl") or seg.get("booking_url", "")
                cash_price_raw = seg.get("cashPriceTotal") or seg.get("cash_price_total") or seg.get("cashPrice") or seg.get("cash_price", 0)
                cash_price = float(cash_price_raw) if cash_price_raw else 0.0  # Handle Decimal from DynamoDB
                
                bookings.append(BookingStep(
                    step_number=step_num,
                    type="hotel",
                    hotel_chain=brand or hotel_name,
                    booking_url=booking_url or f"https://{(brand or hotel_name).lower().replace(' ', '')}.com/points-booking",
                    segment_reference=f"{hotel_name} in {city} ({check_in} to {check_out})",
                    city=city,
                    check_in=check_in,
                    check_out=check_out,
                    nights=nights,
                    payment_method=payment_method,
                    points_used=points_used if payment_method == "points" else None,
                    cash_price=cash_price,
                    surcharge=surcharge if payment_method == "points" else None,
                    program=program if payment_method == "points" else None,
                ))
            
            step_num += 1
        
        # Estimate total time
        if max_time_days > 0:
            estimated_time = f"{max_time_days}-{max_time_days + 1} days"
        elif transfers:
            estimated_time = "1-2 days"
        else:
            estimated_time = "Instant"
        
        warnings = []
        if transfers:
            warnings.append("Complete all transfers before booking to ensure points are available")
        
        return TransferStrategyResponse(
            transfers=transfers,
            bookings=bookings,
            total_points_to_transfer=total_points,
            estimated_total_time=estimated_time,
            warnings=warnings,
        )
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting transfer strategy: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))
