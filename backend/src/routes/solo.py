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

logger = logging.getLogger(__name__)

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
            
            # Build segment description
            if seg_type == "flight":
                segment_name = f"{seg.origin} → {seg.destination}"
                cash_price = seg.cash_price or 0
            else:
                segment_name = f"{seg.name} ({seg.city})"
                cash_price = getattr(seg, 'cash_price_total', 0) or getattr(seg, 'cashPriceTotal', 0)
            
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
        
        result.append(RankedItinerary(
            id=agent_it.id,
            rank=agent_it.rank,
            route=route,
            display_name=display_name,
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
        # Get selection to verify it exists
        selection = solo_trip_service.get_selection(request.trip_id, user_id)
        if not selection:
            raise HTTPException(status_code=404, detail="No selection found. Please select an itinerary first.")
        
        if selection.get("itinerary_id") != request.itinerary_id:
            raise HTTPException(status_code=400, detail="Itinerary ID does not match selection")
        
        # Extract itinerary snapshot
        snapshot = selection.get("itinerary_snapshot", {})
        
        # Debug: log what we received in the snapshot
        logger.info(f"[transfer-strategy] Snapshot keys: {list(snapshot.keys()) if snapshot else 'None'}")
        logger.info(f"[transfer-strategy] Snapshot transfers: {snapshot.get('transfers', 'NOT FOUND')}")
        
        # Generate transfer instructions from snapshot
        transfers = []
        bookings = []
        total_points = 0
        max_time_days = 0
        
        # Process transfers from snapshot
        snapshot_transfers = snapshot.get("transfers", [])
        for idx, t in enumerate(snapshot_transfers):
            source = t.get("sourceProgram") or t.get("source_program") or t.get("fromProgram") or t.get("from_program", "")
            target = t.get("targetProgram") or t.get("target_program") or t.get("toProgram") or t.get("to_program", "")
            points = t.get("pointsToTransfer") or t.get("points_to_transfer", 0)
            ratio = t.get("transferRatio") or t.get("transfer_ratio") or t.get("ratio", 1.0)
            time_str = t.get("expectedTransferTime") or t.get("expected_transfer_time") or t.get("transferTime") or t.get("transfer_time", "instant")
            portal = t.get("portalUrl") or t.get("portal_url", "")
            warning = t.get("warning")
            
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
        
        for seg in segments:
            seg_type = seg.get("type", "flight")
            payment = seg.get("payment", {})
            payment_method = "points" if (payment.get("method") == "points" or payment.get("paymentMethod") == "points") else "cash"
            
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
                cash_price = seg.get("cashPrice") or seg.get("cash_price", 0)
                points_used = payment.get("pointsUsed") or payment.get("points_used", 0)
                surcharge = payment.get("surcharge", 0)
                program = payment.get("program", "")
                
                bookings.append(BookingStep(
                    step_number=step_num,
                    type="flight",
                    airline=airline,
                    booking_url=booking_url or f"https://{airline.lower().replace(' ', '')}.com/award-booking",
                    segment_reference=f"{origin} → {destination} {cabin} on {airline}",
                    origin=origin,
                    destination=destination,
                    departure_time=departure,
                    arrival_time=arrival,
                    cabin_class=cabin,
                    flight_number=flight_num,
                    duration_minutes=duration,
                    payment_method=payment_method,
                    points_used=points_used if payment_method == "points" else None,
                    cash_price=cash_price,
                    surcharge=surcharge if payment_method == "points" else None,
                    program=program if payment_method == "points" else None,
                ))
            else:
                hotel_name = seg.get("name", "Hotel")
                brand = seg.get("brand", "")
                city = seg.get("city", "")
                check_in = seg.get("checkIn") or seg.get("check_in", "")
                check_out = seg.get("checkOut") or seg.get("check_out", "")
                nights = seg.get("nights", 0)
                booking_url = seg.get("bookingUrl") or seg.get("booking_url", "")
                cash_price = seg.get("cashPriceTotal") or seg.get("cash_price_total") or seg.get("cashPrice", 0)
                points_used = payment.get("pointsUsed") or payment.get("points_used", 0)
                surcharge = payment.get("surcharge", 0)
                program = payment.get("program", "")
                
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
