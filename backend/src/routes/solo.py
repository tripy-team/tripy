"""
Solo Booking Routes

This module contains all API endpoints for the solo booking flow.
All responses use snake_case; frontend converts to camelCase via serializers.

Integrates with the real OrchestratorAgent for ILP-based optimization.
"""
import os
import logging
from datetime import datetime, timezone, timedelta
from typing import Dict, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from pydantic import BaseModel

from ..utils.jwt_auth import get_current_user_id, get_user_or_anon_id, is_anonymous
from ..schemas import (
    # Trip schemas
    CreateTripRequest as SoloCreateTripRequest,
    UpdateTripRequest as SoloUpdateTripRequest,
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
    DecisionSummary,
    RejectedAlternative,
    RiskAssessment,
    BookingDetails,
    BookingChecklistStep,
    BookingStep,
    BudgetStatus,
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


def _normalize_bank_for_validation(bank: str) -> str:
    """Normalize a bank identifier for transfer validation lookups."""
    bank_lower = bank.lower().replace("_", "").replace(" ", "")
    bank_map = {
        "amexmr": "amex", "amexmembershiprewards": "amex", "membershiprewards": "amex",
        "chaseur": "chase", "chaseultimaterewards": "chase", "ultimaterewards": "chase",
        "citityp": "citi", "citithankyou": "citi", "thankyoupoints": "citi",
        "capitalone": "capitalone", "capitaloneventurex": "capitalone",
        "bilt": "bilt", "biltrewards": "bilt",
    }
    return bank_map.get(bank_lower, bank_lower)


def _normalize_program_for_validation(program: str) -> str:
    """Normalize a program identifier to IATA code for transfer graph lookups."""
    if not program:
        return ""
    prog_lower = program.lower().replace("_", "").replace(" ", "")
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
        "aeroplan": "AC", "aircanada": "AC", "aircanadaaeroplan": "AC",
        "turkish": "TK", "milesandsmiles": "TK", "miles&smiles": "TK",
        "qatar": "QR", "privilegeclub": "QR",
        "jal": "JL", "japanairlines": "JL",
        "aerlingus": "EI", "aerclub": "EI",
        "finnair": "AY", "finnairplus": "AY",
        "tap": "TAP", "tapmiles&go": "TAP",
    }
    return prog_map.get(prog_lower, program.upper())


def _is_valid_transfer(bank: str, program: str) -> bool:
    """Check if a bank can transfer to a specific airline program."""
    bank_normalized = _normalize_bank_for_validation(bank)
    prog_normalized = _normalize_program_for_validation(program)
    
    if bank_normalized not in EXTENDED_TRANSFER_GRAPH:
        return False
    
    return prog_normalized in EXTENDED_TRANSFER_GRAPH[bank_normalized]


def _find_valid_source_bank(target_program: str, user_banks: list[str]) -> Optional[str]:
    """Find a user bank that can transfer to the target program.
    
    Returns the first user bank that has the target program as a transfer partner,
    or None if no valid path exists.
    """
    prog_normalized = _normalize_program_for_validation(target_program)
    
    for bank in user_banks:
        bank_normalized = _normalize_bank_for_validation(bank)
        partners = EXTENDED_TRANSFER_GRAPH.get(bank_normalized, {})
        if prog_normalized in partners:
            return bank
    return None


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


def _extract_date_from_departure(departure_time: str) -> str:
    """Extract YYYY-MM-DD date string from a departure time value.
    Handles ISO 8601, RFC 2822, and common human-readable formats.
    """
    if not departure_time:
        return ""
    # Fast path: ISO-like strings starting with YYYY-MM-DD
    if len(departure_time) >= 10 and departure_time[4] == "-" and departure_time[7] == "-":
        return departure_time[:10]
    try:
        from dateutil.parser import parse as dateparse
        parsed = dateparse(departure_time)
        return parsed.strftime("%Y-%m-%d")
    except Exception:
        return ""


_CABIN_MAP_UA = {"economy": "7", "premium economy": "3", "business": "2", "first": "1"}
_CABIN_MAP_AA = {"economy": "", "premium economy": "PREMIUM_ECONOMY", "business": "BUSINESS", "first": "FIRST"}
_CABIN_MAP_DL = {"economy": "MAIN", "premium economy": "PREM-ECONOMY", "business": "BUSINESS", "first": "FIRST"}
_CABIN_MAP_BA = {"economy": "M", "premium economy": "W", "business": "J", "first": "F"}
_CABIN_MAP_VS = {"economy": "economy", "premium economy": "premium", "business": "upper", "first": "upper"}
_CABIN_MAP_AC = {"economy": "economy", "premium economy": "premiumeconomy", "business": "business", "first": "first"}


def _build_booking_deep_link(
    program_code: str,
    origin: str,
    destination: str,
    departure_time: str,
    cabin_class: str = "Economy",
    is_award: bool = True,
) -> str:
    """Build an airline-specific deep link URL pre-filled with search parameters.

    Returns a URL that takes the user directly to the airline's flight search
    page with origin, destination, date, and cabin class already filled in.
    Falls back to the airline's award booking page when a deep link format
    is not available for the given program.
    """
    if not program_code:
        return ""

    code = program_code.upper().strip()
    date_str = _extract_date_from_departure(departure_time)
    cabin = (cabin_class or "economy").strip().lower()
    o = origin or ""
    d = destination or ""

    if code == "UA":
        sc = _CABIN_MAP_UA.get(cabin, "7")
        params = (
            f"f={o}&t={d}&d={date_str}&tt=1&ct=1&sc={sc}"
            f"&px=1&taxng=1&newHP=True&clm={sc}"
            f"&st=bestmatches&fareWheel=True"
        )
        if is_award:
            params += "&tqp=A"
        return f"https://www.united.com/en/us/fsr/choose-flights?{params}"

    if code == "AA":
        cab = _CABIN_MAP_AA.get(cabin, "")
        params = (
            f"locale=en_US&pax=1&type=1&searchType={'Award' if is_award else 'Revenue'}"
            f"&adult=1&child=0&infant=0&youngAdult=0"
            f"&from={o}&to={d}&date={date_str}&cabin={cab}"
        )
        return f"https://www.aa.com/booking/choose-flights/1?{params}"

    if code == "DL":
        cab = _CABIN_MAP_DL.get(cabin, "MAIN")
        params = (
            f"tripType=ONE_WAY&departureDate={date_str}"
            f"&from={o}&to={d}&passengers=1"
            f"&deltaOnlySearch=false&cabin={cab}"
        )
        if is_award:
            params += "&awardTravel=true"
        return f"https://www.delta.com/flight-search/book-a-flight?{params}"

    if code == "AS":
        params = (
            f"origin={o}&destination={d}&departure={date_str}"
            f"&adults=1&travelType={'award' if is_award else 'revenue'}"
        )
        return f"https://www.alaskaair.com/shopping/flights?{params}"

    if code == "BA":
        cab = _CABIN_MAP_BA.get(cabin, "M")
        params = (
            f"departureDate={date_str}&from={o}&to={d}"
            f"&cabin={cab}&ADT=1&type={'redeem' if is_award else 'revenue'}"
        )
        return f"https://www.britishairways.com/travel/book/public/en_us?{params}"

    if code in ("AF", "KL"):
        domain = "airfrance.us" if code == "AF" else "klm.us"
        params = (
            f"pax=1:0:0:0:0:0:0:0&cabinClass=ECONOMY"
            f"&activeConnection=0"
            f"&connections={o}>{d}:{date_str.replace('-', '')}"
        )
        if is_award:
            params += "&bookingFlow=REWARD"
        return f"https://www.{domain}/search/offers?{params}"

    if code == "VS":
        cab = _CABIN_MAP_VS.get(cabin, "economy")
        params = (
            f"origin={o}&destination={d}&departureDate={date_str}"
            f"&adultCount=1&childCount=0&infantCount=0&searchType=ONEWAY"
            f"&cabinClass={cab}"
        )
        return f"https://www.virginatlantic.com/flight/search?{params}"

    if code == "AC":
        cab = _CABIN_MAP_AC.get(cabin, "economy")
        params = (
            f"org0={o}&dest0={d}&departureDt0={date_str}"
            f"&ADT=1&tripType=O&marketCode=US&lang=en-CA"
            f"&cabinClass={cab}"
        )
        if is_award:
            params += "&awardBooking=true"
        return f"https://www.aircanada.com/aeroplan/redeem/availability/outbound?{params}"

    if code == "SQ":
        params = (
            f"originStationCode={o}&destinationStationCode={d}"
            f"&departureDate={date_str}&tripType=O&numOfAdults=1"
            f"&cabinClass=Y"
        )
        if is_award:
            params += "&redemptionBooking=true"
        return f"https://www.singaporeair.com/en_UK/plan-and-book/book-flights/?{params}"

    if code == "NH":
        return f"https://www.ana.co.jp/en/us/amc/reference/tukau/award/int/search/?route={o}-{d}&date={date_str}"

    if code == "TK":
        params = (
            f"originCode={o}&destinationCode={d}"
            f"&departureDateM={date_str}&returnDateM="
            f"&tripType=O&passengerCount=1"
        )
        if is_award:
            params += "&awardBooking=true"
        return f"https://www.turkishairlines.com/en-us/flights/?{params}"

    if code == "EK":
        params = (
            f"origin={o}&destination={d}&departDate={date_str}"
            f"&pax=1&cabin=Economy&tripType=OW"
        )
        return f"https://www.emirates.com/us/english/book/?{params}"

    if code == "QR":
        params = (
            f"from={o}&to={d}&departing={date_str}"
            f"&adults=1&children=0&infants=0&travel-class=Economy"
            f"&trip-type=O"
        )
        if is_award:
            params += "&is498=true"
        return f"https://www.qatarairways.com/en-us/book-trip/flights.html?{params}"

    if code == "AV":
        params = (
            f"origin={o}&destination={d}&date={date_str}"
            f"&adults=1&children=0&infants=0"
        )
        return f"https://www.lifemiles.com/booking/flight-search?{params}"

    if code == "TP":
        params = (
            f"origin={o}&destination={d}&departureDate={date_str}"
            f"&passengers=1&promoCode=&type=OW&classType={cabin_class}"
        )
        return f"https://www.flytap.com/en-us/booking?{params}"

    # Fallback: return empty to let caller use PROGRAM_METADATA generic URL
    return ""


# Singleton orchestrator
_orchestrator: Optional[OrchestratorAgent] = None


def get_orchestrator() -> OrchestratorAgent:
    """Get or create the orchestrator agent (singleton)."""
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = OrchestratorAgent()
    return _orchestrator

router = APIRouter(prefix="/solo", tags=["Solo Booking"])


def _get_trip_with_anon_fallback(
    trip_id: str,
    user_id: str,
    http_request: Request,
):
    """
    Fetch a solo trip with anon-session fallback.

    Tries the authenticated user_id first; on PermissionError falls back to
    the X-Anon-Session-Id header so trips created before sign-in still work
    even when session migration hasn't completed yet.
    """
    try:
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
        return trip
    except PermissionError:
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                trip = solo_trip_service.get_solo_trip(trip_id, anon_id)
                if trip:
                    logger.info(
                        f"Trip {trip_id} accessed via anon fallback "
                        f"(user={user_id}, anon={anon_id}). "
                        "Session migration may not have completed."
                    )
                    return trip
            except (PermissionError, ValueError):
                pass
        raise


# ============================================================================
# Trip Endpoints
# ============================================================================

@router.post("/trips", response_model=TripResponse)
async def create_solo_trip(
    request: SoloCreateTripRequest,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Create a new solo trip.
    
    Supports both authenticated users and anonymous sessions.
    Anonymous users can generate trips without signing in.
    
    This endpoint creates a trip with:
    - Origin and destinations (IATA codes)
    - Trip type (one_way/round_trip)
    - Date mode (fixed/flexible)
    - Preferences (flight class, etc.)
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
    request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """Get a solo trip by ID. Supports both authenticated and anonymous sessions."""
    try:
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        # Convert camelCase storage to snake_case API response
        return trip_storage_to_response(trip)
    except PermissionError as e:
        # Fallback: try with the anonymous session ID from the header
        anon_id = request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                trip = solo_trip_service.get_solo_trip(trip_id, anon_id)
                if trip:
                    logger.info(
                        f"Trip {trip_id} accessed via anon fallback (user={user_id}, anon={anon_id}). "
                        "Session migration may not have completed."
                    )
                    return trip_storage_to_response(trip)
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting solo trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/trips/{trip_id}", response_model=TripResponse)
async def update_solo_trip(
    trip_id: str,
    request: SoloUpdateTripRequest,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Update an existing solo trip's parameters.

    Accepts any subset of trip fields. Resets the trip to 'draft' status
    and clears cached optimization so the user can re-search.
    """
    try:
        trip = solo_trip_service.update_solo_trip(trip_id, user_id, request)
        return trip_storage_to_response(trip)
    except PermissionError:
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                trip = solo_trip_service.update_solo_trip(trip_id, anon_id, request)
                return trip_storage_to_response(trip)
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized to modify this trip")
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating solo trip: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/status", response_model=StatusUpdateResponse)
async def update_solo_trip_status(
    trip_id: str,
    request: UpdateTripStatusRequest,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Update trip status.
    
    Status lifecycle: draft → optimized → selected → instructions_unlocked → booked → completed
    Supports anonymous users for the 'booked' status.
    """
    try:
        result = solo_trip_service.update_solo_trip_status(
            trip_id, 
            request.status, 
            user_id,
            request.payment_proof
        )

        # Send "I booked it" acknowledgment email for authenticated users
        if request.status == "booked" and not is_anonymous(user_id):
            try:
                from ..services.user_service import get_user
                from ..services.email_service import send_i_booked_it_email, is_email_enabled
                from ..config import FRONTEND_URL
                if is_email_enabled():
                    user = get_user(user_id)
                    user_email = user.get("email") if user else None
                    if user_email:
                        trip_link = f"{FRONTEND_URL}/solo/results?trip_id={trip_id}"
                        send_i_booked_it_email(to_email=user_email, trip_link=trip_link)
                        logger.info(f"Sent booking acknowledgment email to {user_email}")
            except Exception as e:
                logger.warning(f"Failed to send booking ack email: {e}")

        return result
    except PermissionError:
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                return solo_trip_service.update_solo_trip_status(
                    trip_id, request.status, anon_id, request.payment_proof
                )
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized to access this trip")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error updating trip status: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/select", response_model=SelectionResponse)
async def select_itinerary(
    trip_id: str,
    request: SelectItineraryRequest,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
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
    except PermissionError:
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                result = solo_trip_service.select_itinerary(trip_id, anon_id, request)
                logger.info(f"[select_itinerary] Selection saved via anon fallback")
                return result
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized to access this trip")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error selecting itinerary: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/trips/{trip_id}/selection", response_model=SelectionResponse)
async def get_selection(
    trip_id: str,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Get the selected itinerary snapshot for a trip.
    
    Returns the itinerary that was selected, including the full snapshot.
    If no selection exists, returns ok=True with null fields (not 404).
    """
    try:
        selection = solo_trip_service.get_selection(trip_id, user_id)
        if not selection:
            logger.info(f"[get_selection] trip_id={trip_id}: No selection found")
            return SelectionResponse(ok=True)
        
        snapshot = selection.get('itinerary_snapshot', {})
        if isinstance(snapshot, dict):
            transfers = snapshot.get('transfers', [])
            logger.info(f"[get_selection] trip_id={trip_id}: Found selection with {len(transfers)} transfers")
        else:
            logger.info(f"[get_selection] trip_id={trip_id}: Found selection, snapshot type={type(snapshot)}")
        
        selection_data = {k: v for k, v in selection.items() if k != 'ok'}
        return SelectionResponse(ok=True, **selection_data)
    except PermissionError:
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                selection = solo_trip_service.get_selection(trip_id, anon_id)
                if not selection:
                    return SelectionResponse(ok=True)
                selection_data = {k: v for k, v in selection.items() if k != 'ok'}
                return SelectionResponse(ok=True, **selection_data)
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized to access this trip")
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
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """Get points balances for a trip. Supports anonymous sessions."""
    try:
        return solo_trip_service.get_points(trip_id, user_id)
    except PermissionError:
        # Anon fallback: try with the anonymous session ID from the header
        anon_id = http_request.headers.get("X-Anon-Session-Id")
        if anon_id and anon_id.startswith("anon_"):
            try:
                return solo_trip_service.get_points(trip_id, anon_id)
            except (PermissionError, ValueError):
                pass
        raise HTTPException(status_code=403, detail="Not authorized to access this trip's points")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.error(f"Error getting trip points: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/trips/{trip_id}/points", response_model=PointsSummaryResponse)
async def upsert_trip_points(
    trip_id: str,
    request: SoloUpsertPointsRequest,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Upsert points balances for a trip. Supports anonymous sessions.
    
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
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Optimize a solo trip using the real ILP-based orchestrator.
    Supports anonymous sessions — no sign-in required.
    
    Fixup 3: Uses trip preferences from backend (source of truth).
    Only tripId + points + optional mode override come from request.
    """
    try:
        # Get trip to load preferences (with anon fallback for pre-sign-in trips)
        trip = _get_trip_with_anon_fallback(request.trip_id, user_id, http_request)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Resolve mode: override takes precedence, else trip setting
        mode = request.optimization_mode_override or trip.get("optimizationMode", "balanced")
        
        # Check cache (unless force_refresh is requested)
        force_refresh = getattr(request, 'force_refresh', False)
        
        # Build cache-key points: merge payer_points if present for consistent hashing
        cache_points = request.points
        if request.payer_points:
            merged = {}
            for payer_id, payer_balances in request.payer_points.items():
                for program, balance in payer_balances.items():
                    # Include payer_id in key to distinguish "alice:amex 50k" from "bob:amex 50k"
                    merged[f"{payer_id}:{program}"] = balance
            cache_points = merged
        
        cache_key = solo_trip_service.compute_cache_key(
            request.trip_id, 
            trip, 
            cache_points, 
            mode
        )
        
        if not force_refresh:
            cached = solo_trip_service.get_cached_optimization(request.trip_id, cache_key)
            if cached and not solo_trip_service.is_cache_expired(cached):
                logger.info(f"[solo/optimize] Returning cached results for trip {request.trip_id}")
                return _build_response_from_cached(cached)
        else:
            logger.info(f"[solo/optimize] Force refresh requested - bypassing cache for trip {request.trip_id}")
        
        # Run REAL optimization using the orchestrator
        orchestrator = get_orchestrator()
        
        # Build the agent request with trip preferences
        # Budget from trip (camelCase: maxBudget), or None for no limit
        budget = trip.get("maxBudget") or trip.get("max_budget")
        
        # Convert to float if present
        if budget is not None:
            try:
                budget = float(budget)
            except (TypeError, ValueError):
                budget = None
        
        logger.info(f"[solo/optimize] Budget from trip: ${budget if budget else 'None (no limit)'}")
        
        # Multi-payer support: when payer_points is provided, merge into points
        # for backward-compatible code paths (cache key, logging, etc.)
        effective_points = request.points
        if request.payer_points:
            merged = {}
            for payer_id, payer_balances in request.payer_points.items():
                for program, balance in payer_balances.items():
                    merged[program] = merged.get(program, 0) + balance
            effective_points = merged
            logger.info(f"[solo/optimize] Multi-payer mode: {len(request.payer_points)} payers, merged points: {merged}")
        
        # Log points being used for optimization
        points_summary = {k: f"{v:,}" for k, v in effective_points.items()} if effective_points else {}
        total_points = sum(effective_points.values()) if effective_points else 0
        logger.info(f"[solo/optimize] Points for optimization: {points_summary} (total: {total_points:,})")
        
        # Map cabin class preference (use camelCase field names)
        cabin_classes = _map_flight_class(trip.get("flightClass", "economy"))
        
        # Read advanced flight filters from trip preferences
        include_budget_airlines = trip.get("includeBudgetAirlines", True)
        max_stops = int(trip.get("maxStops", 0))
        departure_hour_range = trip.get("departureHourRange") or None
        arrival_hour_range = trip.get("arrivalHourRange") or None
        # Sanitize hour ranges: must be [int, int] or None
        if departure_hour_range and len(departure_hour_range) == 2:
            departure_hour_range = [int(departure_hour_range[0]), int(departure_hour_range[1])]
        else:
            departure_hour_range = None
        if arrival_hour_range and len(arrival_hour_range) == 2:
            arrival_hour_range = [int(arrival_hour_range[0]), int(arrival_hour_range[1])]
        else:
            arrival_hour_range = None
        
        logger.info(f"[solo/optimize] Flight filters: include_budget={include_budget_airlines}, max_stops={max_stops}, dep_hours={departure_hour_range}, arr_hours={arrival_hour_range}")
        
        agent_request = AgentOptimizeSoloRequest(
            trip_id=request.trip_id,
            points=effective_points,
            budget=budget,
            cabin_classes=cabin_classes,
            optimization_mode=mode,
            include_budget_airlines=include_budget_airlines,
            max_stops=max_stops,
            departure_hour_range=departure_hour_range,
            arrival_hour_range=arrival_hour_range,
            payer_points=request.payer_points,
        )
        
        logger.info(f"[solo/optimize] Running orchestrator for trip {request.trip_id} with optimization_mode={mode}, budget=${budget if budget else 'unlimited'}")
        
        # Call the real orchestrator with safe degradation (Task 17)
        degradation_warnings = []
        try:
            agent_response = await orchestrator.optimize_solo(agent_request)
        except Exception as search_err:
            logger.warning(f"[solo/optimize] Primary search failed: {search_err}. Attempting cash-only fallback.")
            degradation_warnings.append(
                "Award search temporarily unavailable. Showing cash-only recommendation. "
                "Points-based options may be available if you try again later."
            )
            try:
                # Fallback: try cash-only optimization (no points)
                fallback_request = AgentOptimizeSoloRequest(
                    trip_id=request.trip_id,
                    points={},  # No points = cash only
                    budget=budget,
                    cabin_classes=cabin_classes,
                    optimization_mode="oop",  # Force out-of-pocket mode for cash
                )
                agent_response = await orchestrator.optimize_solo(fallback_request)
            except Exception as fallback_err:
                logger.error(f"[solo/optimize] Cash-only fallback also failed: {fallback_err}")
                raise HTTPException(
                    status_code=503,
                    detail="Flight search is temporarily unavailable. Please try again in a few minutes."
                )
        
        # Check for partial failures in the response
        if hasattr(agent_response, 'warnings') and agent_response.warnings:
            for w in agent_response.warnings:
                if 'error' in w.lower() or 'fail' in w.lower() or 'unavailable' in w.lower():
                    degradation_warnings.append(w)
        
        # Transform to our response schema with volatility-aware TTL (Task 8)
        now = datetime.now(timezone.utc)
        computed_str = now.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # TTL Strategy: Points itineraries expire faster (more volatile)
        has_points = any(v > 0 for v in request.points.values()) if request.points else False
        if has_points:
            # Points redemptions: 10-30 min TTL (award availability changes fast)
            ttl_minutes = 20  # Default 20 minutes for points
        else:
            # Cash-only: 1-6 hours (more stable)
            ttl_minutes = 180  # 3 hours for cash-only
        
        expires = now + timedelta(minutes=ttl_minutes)
        expires_str = expires.strftime('%Y-%m-%dT%H:%M:%SZ')
        
        # Get party size from trip for cost scaling
        # Costs from orchestrator are per-person; we need to scale to party total
        # Convert to int explicitly (DynamoDB may return Decimal)
        adults = int(trip.get("adults") or 1)
        children = int(trip.get("children") or 0)
        party_size = max(1, adults + children)
        
        logger.info(f"[solo/optimize] Party size: {party_size} (adults={adults}, children={children})")
        
        # Convert agent itineraries to our schema format (with party_size scaling)
        itineraries = _transform_itineraries(agent_response.itineraries, party_size=party_size)
        
        # Generate insights from the results
        global_insights = _generate_insights(itineraries) if itineraries else []
        
        # Check if points are estimated (for confidence level)
        is_estimated = any(
            v == 0 for v in request.points.values()
        ) if request.points else True
        
        # Generate decision summary, risk, booking details, and rejection reasons
        decision_summary = None
        rejected_alternatives = []
        booking_details = None
        if itineraries:
            best = itineraries[0]
            # Add value labels, risk, and booking details to all itineraries
            for it in itineraries:
                it.value_label = _humanize_cpp(it.oop_metrics.average_cpp)
                it.risk = _generate_risk_assessment(it)
                it.booking_details = _generate_booking_details(it, trip)
            
            decision_summary = _generate_decision_summary(best, itineraries, is_estimated)
            best.decision_summary = decision_summary
            rejected_alternatives = _generate_rejected_alternatives(best, itineraries)
            booking_details = best.booking_details
        
        result = {
            "itineraries": [it.model_dump() for it in itineraries],
            "best_option": itineraries[0].id if itineraries else None,
            "warnings": (agent_response.warnings or []) + degradation_warnings,
            "global_insights": [i.model_dump() for i in global_insights],
            "risk_mode": "balanced",
            "decision_summary": decision_summary.model_dump() if decision_summary else None,
            "rejected_alternatives": [ra.model_dump() for ra in rejected_alternatives],
            "booking_details": booking_details.model_dump() if booking_details else None,
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
        
        # Build BudgetStatus from result data
        _budget_status = None
        if budget is None:
            _budget_status = BudgetStatus(status="no_budget_set", actual_oop=0.0)
        elif itineraries:
            best_oop = itineraries[0].oop_metrics.total_out_of_pocket if itineraries[0].oop_metrics else 0.0
            within = getattr(itineraries[0], 'within_budget', True)
            if within:
                _budget_status = BudgetStatus(
                    status="within_budget",
                    user_budget=budget,
                    actual_oop=best_oop,
                )
            else:
                shortfall = best_oop - budget
                _budget_status = BudgetStatus(
                    status="closest_over_budget",
                    user_budget=budget,
                    actual_oop=best_oop,
                    required_budget=best_oop,
                    shortfall=shortfall,
                    suggested_budget=best_oop * 1.10,
                )
        
        return OptimizeSoloResponse(
            itineraries=itineraries,
            best_option=itineraries[0].id if itineraries else None,
            warnings=(agent_response.warnings or []) + degradation_warnings,
            global_insights=global_insights,
            risk_mode="balanced",
            budget_status=_budget_status,
            decision_summary=decision_summary,
            rejected_alternatives=rejected_alternatives,
            booking_details=booking_details,
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


def _transform_itineraries(agent_itineraries: list, party_size: int = 1) -> list[RankedItinerary]:
    """Transform orchestrator itineraries to our schema format (flights only).
    
    Args:
        agent_itineraries: Itineraries from the orchestrator (per-person costs)
        party_size: Number of travelers to scale costs for
        
    Returns:
        List of RankedItinerary with costs scaled to party total
    """
    result = []
    
    for agent_it in agent_itineraries:
        # Build segments from agent segments (flights only)
        segments = []
        for seg in agent_it.segments:
            # Skip non-flight segments
            if not hasattr(seg, 'airline'):
                continue
            
            # Determine payment method and extract details
            # Handle payment as either a Pydantic model or dict (e.g., from cache/DynamoDB)
            payment = seg.payment
            pay_method = (
                getattr(payment, 'method', None)
                or (payment.get('method') if isinstance(payment, dict) else None)
            )
            if pay_method == 'points':
                payment_method = "points"
                # Get per-person values and scale by party_size
                if isinstance(payment, dict):
                    per_person_points = payment.get('points_used') or payment.get('pointsUsed') or 0
                    per_person_surcharge = payment.get('surcharge', 0)
                    cpp = payment.get('cpp_achieved') or payment.get('cppAchieved', 0)
                    transfer_data = payment.get('transfer')
                else:
                    per_person_points = getattr(payment, 'points_used', None) or getattr(payment, 'pointsUsed', 0)
                    per_person_surcharge = getattr(payment, 'surcharge', 0)
                    cpp = getattr(payment, 'cpp_achieved', None) or getattr(payment, 'cppAchieved', 0)
                    transfer_data = getattr(payment, 'transfer', None)
                points_used = per_person_points * party_size if per_person_points else None
                surcharge = per_person_surcharge * party_size if per_person_surcharge else 0
                # CPP stays the same (it's a ratio, not a total)
                transfer_from = None
                transfer_to = None
                if transfer_data:
                    if isinstance(transfer_data, dict):
                        transfer_from = transfer_data.get('from_program') or transfer_data.get('fromProgram')
                        transfer_to = transfer_data.get('to_program') or transfer_data.get('toProgram')
                    else:
                        transfer_from = getattr(transfer_data, 'from_program', None)
                        transfer_to = getattr(transfer_data, 'to_program', None)
            else:
                payment_method = "cash"
                points_used = None
                surcharge = None
                cpp = None
                transfer_from = None
                transfer_to = None
            
            # Build flight segment with scaled costs
            segment_name = f"{seg.origin} → {seg.destination}"
            per_person_cash = seg.cash_price or 0
            # If cash_price is 0 but this is a cash booking, fall back to CashPayment.amount
            if per_person_cash == 0 and pay_method == "cash":
                if isinstance(payment, dict):
                    per_person_cash = float(payment.get('amount', 0) or 0)
                else:
                    per_person_cash = float(getattr(payment, 'amount', 0) or 0)
            cash_price = per_person_cash * party_size  # Scale cash price by party_size
            if payment_method == "points":
                program = (payment.get('program') if isinstance(payment, dict) else getattr(payment, 'program', None))
            else:
                program = None
            
            # CRITICAL: Extract connection details (legs, layovers, stops)
            # These come from the FlightSegment model built in adapter_v3.py
            stops = getattr(seg, 'stops', 0)
            seg_legs = getattr(seg, 'legs', [])
            seg_layovers = getattr(seg, 'layovers', [])
            
            # Convert legs to FlightLegDetail schema objects if they exist
            from ..schemas.optimize import FlightLegDetail, LayoverDetail
            legs = []
            for leg in seg_legs:
                if hasattr(leg, 'flight_number'):
                    # Pydantic FlightLeg model from agents/models.py
                    legs.append(FlightLegDetail(
                        origin=leg.origin,
                        destination=leg.destination,
                        departure_time=getattr(leg, 'departure_time', None),
                        arrival_time=getattr(leg, 'arrival_time', None),
                        duration_minutes=getattr(leg, 'duration_minutes', None),
                        flight_number=leg.flight_number,
                        marketing_carrier=getattr(leg, 'marketing_carrier', ''),
                        operating_carrier=getattr(leg, 'operating_carrier', None),
                    ))
                elif isinstance(leg, dict):
                    # Dict format
                    legs.append(FlightLegDetail(
                        origin=leg.get('origin', ''),
                        destination=leg.get('destination', ''),
                        departure_time=leg.get('departure_time') or leg.get('departureTime'),
                        arrival_time=leg.get('arrival_time') or leg.get('arrivalTime'),
                        duration_minutes=leg.get('duration_minutes') or leg.get('durationMinutes'),
                        flight_number=leg.get('flight_number') or leg.get('flightNumber', ''),
                        marketing_carrier=leg.get('marketing_carrier') or leg.get('marketingCarrier', ''),
                        operating_carrier=leg.get('operating_carrier') or leg.get('operatingCarrier'),
                    ))
            
            # Convert layovers to LayoverDetail schema objects
            layovers = []
            for lay in seg_layovers:
                if isinstance(lay, dict):
                    duration_mins = lay.get('duration_minutes') or lay.get('durationMinutes', 0)
                    layovers.append(LayoverDetail(
                        airport=lay.get('airport', ''),
                        airport_name=lay.get('airport_name') or lay.get('airportName'),
                        duration_minutes=duration_mins,
                        is_short=duration_mins < 60,
                        is_long=duration_mins > 240,
                    ))
            
            # Update segment name to show full route if connecting flight
            if stops > 0 and legs:
                route_airports = [legs[0].origin] + [leg.destination for leg in legs]
                segment_name = " → ".join(route_airports)
            
            segments.append(SegmentBreakdown(
                segment=segment_name,
                type="flight",
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
                # CRITICAL: Connection details for multi-leg flights
                stops=stops,
                legs=legs,
                layovers=layovers,
                ticketing_confirmed=getattr(seg, 'ticketing_confirmed', False),
            ))
        
        # Build transfers (scale points by party_size)
        transfers = []
        for idx, t in enumerate(agent_it.transfers or []):
            per_person_points = t.points_to_transfer
            scaled_points = per_person_points * party_size
            bonus_percentage = None
            bonus_end_date = None
            try:
                from ..services.transfer_bonus_scraper import get_bonus_for_transfer
                bonus_record = get_bonus_for_transfer(t.from_program, t.to_program)
                if bonus_record:
                    bonus_percentage = bonus_record.bonus_pct
                    bonus_end_date = bonus_record.end_date.isoformat() if bonus_record.end_date else None
            except Exception:
                pass
            transfers.append(TransferInstruction(
                step_number=idx + 1,
                source_program=t.from_program,
                target_program=t.to_program,
                points_to_transfer=scaled_points,
                transfer_ratio=t.ratio,
                expected_transfer_time=t.transfer_time,
                portal_url=t.portal_url,
                warning=t.warning,
                is_direct=getattr(t, 'is_direct', False),
                payer_id=getattr(t, 'payer_id', None),
                payer_name=getattr(t, 'payer_name', None),
                bonus_percentage=bonus_percentage,
                bonus_end_date=bonus_end_date,
            ))
        
        # Build OOP metrics (scale costs by party_size, percentages stay same)
        metrics = agent_it.oop_metrics
        oop_metrics = OOPMetrics(
            total_cash_price=metrics.total_cash_price * party_size,
            total_out_of_pocket=metrics.total_out_of_pocket * party_size,
            cash_saved=metrics.cash_saved * party_size,
            savings_percentage=metrics.savings_percentage,  # Percentage stays the same
            total_points_used=metrics.total_points_used * party_size,
            average_cpp=metrics.average_cpp,  # CPP (cents per point) stays the same
            payer_breakdown=getattr(metrics, 'payer_breakdown', None),
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


def _humanize_cpp(cpp: float) -> str:
    """Convert CPP number to human-readable value label. Task 13: Replace numeric-only language."""
    if cpp >= 2.0:
        return "Exceptional value"
    elif cpp >= 1.5:
        return "Excellent value"
    elif cpp >= 1.2:
        return "Solid use of points"
    elif cpp >= 0.8:
        return "Fair redemption"
    elif cpp >= 0.5:
        return "Below average — consider cash"
    else:
        return "Wasteful redemption"


def _humanize_savings(pct: float) -> str:
    """Convert savings percentage to human-readable text."""
    if pct >= 50:
        return "massive savings"
    elif pct >= 30:
        return "significant savings"
    elif pct >= 15:
        return "solid savings"
    elif pct >= 5:
        return "modest savings"
    else:
        return "minimal savings"


def _generate_decision_summary(
    best: RankedItinerary,
    all_itineraries: list[RankedItinerary],
    is_estimated: bool = False,
) -> DecisionSummary:
    """
    Generate the decision confidence header for the recommended itinerary.
    Uses opinionated, confident language — NOT neutral or numeric.
    
    CRITICAL DESIGN:
    - confidence_level = "Should I book this?" (risk, data quality, execution complexity)
    - value_label = "How good is this financially?" (CPP, savings)
    These are INDEPENDENT dimensions. Cash-only trips can be high confidence.
    CPP does NOT determine confidence.
    """
    metrics = best.oop_metrics
    cpp = metrics.average_cpp
    savings_pct = metrics.savings_percentage
    saved = metrics.cash_saved
    oop = metrics.total_out_of_pocket
    points_used = metrics.total_points_used
    is_cash_only = points_used == 0
    
    # --- Flight characteristics ---
    has_direct = any(seg.stops == 0 for seg in best.segments if seg.type == "flight")
    has_transfers = any(not getattr(t, 'is_direct', False) for t in best.transfers)
    short_connections = any(seg.has_short_connection for seg in best.segments)
    
    # --- Use the risk assessment (already computed before this function is called) ---
    risk = best.risk
    risk_level = risk.level if risk else "low"
    risk_first_flag = risk.flags[0] if risk and risk.flags else ""
    
    # =========================================================================
    # DIMENSION 1: Decision Confidence (badge)
    # Answers: "Should I book this?"
    # Inputs: execution risk, data completeness, booking complexity
    # NOT inputs: CPP, savings percentage
    # =========================================================================
    if risk_level == "high":
        confidence = "low"
        confidence_reason = f"Complex booking — {risk_first_flag}" if risk_first_flag else "High execution risk"
    elif is_estimated and has_transfers:
        confidence = "medium"
        confidence_reason = "Estimated balances and transfers needed — verify points before booking"
    elif is_estimated:
        confidence = "medium"
        confidence_reason = "Based on estimated balances — verify your actual points before booking"
    elif risk_level == "medium":
        confidence = "medium"
        confidence_reason = f"Good plan with some complexity — {risk_first_flag}" if risk_first_flag else "Moderate booking complexity"
    else:
        # Low risk, not estimated → high confidence regardless of CPP
        confidence = "high"
        if is_cash_only:
            confidence_reason = "Clean cash booking — straightforward to book"
        elif has_transfers:
            confidence_reason = "Strong plan — initiate transfers and book within 48 hours"
        else:
            confidence_reason = "Clean booking — straightforward to book"
    
    # =========================================================================
    # DIMENSION 2: Value Assessment (label)
    # Answers: "How good is this financially?"
    # Independent from confidence.
    # =========================================================================
    if is_cash_only:
        value_label = "Cash booking"
    elif cpp >= 2.0:
        value_label = "Exceptional value"
    elif cpp >= 1.5:
        value_label = "Excellent value"
    elif cpp >= 1.0:
        value_label = "Good value"
    elif cpp >= 0.8:
        value_label = "Fair value"
    else:
        value_label = "Below-average redemption"
    
    # =========================================================================
    # Headline — confident, opinionated
    # =========================================================================
    parts = []
    if saved > 100 and not is_cash_only:
        parts.append(f"saving you ${saved:,.0f}")
    if has_direct:
        parts.append("with a direct flight")
    
    if parts:
        headline = f"Book this plan — {' '.join(parts)}."
    elif is_cash_only and has_direct:
        headline = "Book this — best cash price with a direct flight."
    elif is_cash_only:
        headline = "Book this — best cash price for your route."
    elif savings_pct > 0:
        headline = f"This is your best option — {_humanize_savings(savings_pct)} vs paying cash."
    else:
        headline = "This is your smartest move right now."
    
    # =========================================================================
    # Why it's good (bullet points)
    # =========================================================================
    why_good = []
    if is_cash_only:
        why_good.append("Best cash option we found for this route")
    elif savings_pct > 0:
        why_good.append(f"Saves {savings_pct:.0f}% compared to paying full cash price")
    if not is_cash_only and cpp >= 1.5:
        why_good.append(f"{_humanize_cpp(cpp)} — your points are working hard ({cpp:.1f}¢ each)")
    elif not is_cash_only and cpp >= 1.0:
        why_good.append(f"{_humanize_cpp(cpp)} — better than the typical redemption")
    if has_direct:
        why_good.append("Direct flight — no stressful connections")
    if oop < 200:
        why_good.append(f"Only ${oop:,.0f} out of pocket")
    elif oop < 500:
        why_good.append(f"${oop:,.0f} out of pocket — reasonable for this route")
    if not why_good:
        why_good.append("Best combination of price and convenience we could find")
    
    # =========================================================================
    # Tradeoffs (honest)
    # =========================================================================
    tradeoffs = []
    if has_transfers:
        actual_transfers = [t for t in best.transfers if not getattr(t, 'is_direct', False)]
        transfer_time_total = len(actual_transfers)
        tradeoffs.append(f"Requires {transfer_time_total} point transfer{'s' if transfer_time_total > 1 else ''} (plan 1-3 days ahead)")
    
    non_direct = [seg for seg in best.segments if seg.type == "flight" and seg.stops > 0]
    for seg in non_direct:
        tradeoffs.append(f"{seg.origin}→{seg.destination}: {seg.stops} stop{'s' if seg.stops > 1 else ''}")
    
    if is_cash_only and points_used == 0 and not is_estimated:
        tradeoffs.append("No points applied — your points programs don't connect to available flights")
    
    if not tradeoffs:
        tradeoffs.append("Nothing major — this is a clean plan")
    
    # =========================================================================
    # Risks
    # =========================================================================
    risks = []
    if has_transfers:
        risks.append("Award availability can change — book within 48 hours of transferring")
    if is_estimated:
        risks.append("Your balances are estimated — actual points may differ")
    if short_connections:
        risks.append("Short connection time on one or more legs — check with airline")
    
    if not risks:
        risks.append("Low risk — straightforward booking")
    
    return DecisionSummary(
        headline=headline,
        confidence_level=confidence,
        confidence_reason=confidence_reason,
        value_label=value_label,
        why_good=why_good,
        tradeoffs=tradeoffs,
        risks=risks,
        is_estimated=is_estimated,
    )


def _generate_rejected_alternatives(
    best: RankedItinerary,
    all_itineraries: list[RankedItinerary],
) -> list[RejectedAlternative]:
    """
    Task 8: Explain why top alternative options were rejected.
    Generates human, opinionated rejection reasons.
    """
    if len(all_itineraries) <= 1:
        return []
    
    alternatives = []
    best_metrics = best.oop_metrics
    
    # Find cheapest alternative (lowest OOP)
    cheapest = min(
        (it for it in all_itineraries if it.id != best.id),
        key=lambda it: it.oop_metrics.total_out_of_pocket,
        default=None,
    )
    if cheapest and cheapest.oop_metrics.total_out_of_pocket < best_metrics.total_out_of_pocket:
        diff = best_metrics.total_out_of_pocket - cheapest.oop_metrics.total_out_of_pocket
        # Explain why cheaper isn't better
        reasons = []
        cheap_stops = sum(seg.stops for seg in cheapest.segments if seg.type == "flight")
        best_stops = sum(seg.stops for seg in best.segments if seg.type == "flight")
        if cheap_stops > best_stops:
            reasons.append(f"requires {cheap_stops} stop{'s' if cheap_stops > 1 else ''} vs our pick's {best_stops}")
        if cheapest.oop_metrics.average_cpp < best_metrics.average_cpp * 0.8:
            reasons.append("wastes your points (poor redemption value)")
        
        reason = f"${diff:,.0f} cheaper, but " + (" and ".join(reasons) if reasons else "less convenient overall") + "."
        alternatives.append(RejectedAlternative(
            label="Cheapest option",
            description=cheapest.display_name,
            rejection_reason=reason,
            price_or_points=f"${cheapest.oop_metrics.total_out_of_pocket:,.0f}",
        ))
    
    # Find best CPP alternative
    best_cpp_it = max(
        (it for it in all_itineraries if it.id != best.id),
        key=lambda it: it.oop_metrics.average_cpp,
        default=None,
    )
    if best_cpp_it and best_cpp_it.oop_metrics.average_cpp > best_metrics.average_cpp:
        extra_cost = best_cpp_it.oop_metrics.total_out_of_pocket - best_metrics.total_out_of_pocket
        if extra_cost > 50:
            reason = f"Higher points value ({best_cpp_it.oop_metrics.average_cpp:.1f}¢/pt) but costs ${extra_cost:,.0f} more out of pocket."
        else:
            reason = f"Slightly better points value but less convenient routing."
        alternatives.append(RejectedAlternative(
            label="Best points value",
            description=best_cpp_it.display_name,
            rejection_reason=reason,
            price_or_points=f"{best_cpp_it.oop_metrics.average_cpp:.1f}¢/pt",
        ))
    
    # Add a "Google Flights suggestion" rejection
    if best_metrics.cash_saved > 100:
        alternatives.append(RejectedAlternative(
            label="What Google Flights would show",
            description="Full cash price booking",
            rejection_reason=f"You'd pay ${best_metrics.total_cash_price:,.0f} in cash. We saved you ${best_metrics.cash_saved:,.0f} by using your points strategically.",
            price_or_points=f"${best_metrics.total_cash_price:,.0f}",
        ))
    
    return alternatives


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


def _generate_risk_assessment(itinerary: RankedItinerary) -> RiskAssessment:
    """
    Task 4: Generate risk assessment for an itinerary using v1 heuristics.
    
    Rules:
    - Separate tickets / self-transfer → high
    - Tight connection (<60 min domestic, <90 min international) → medium/high
    - Overnight layover → flag
    - Carrier changes between legs → medium
    """
    flags = []
    score = 0
    
    for seg in itinerary.segments:
        if seg.type != "flight":
            continue
        
        # Check if separate tickets — only flag when there are actual connecting
        # legs between two places (i.e., a multi-leg connection like SEA → ORD → JFK).
        # Direct flights or segments without connecting legs don't have this risk.
        has_connecting_legs = seg.stops > 0 and (len(seg.legs) > 1 or len(seg.layovers) > 0)
        if has_connecting_legs and not seg.ticketing_confirmed:
            flags.append(
                f"Separate tickets on {seg.origin}→{seg.destination} — "
                "if one flight is delayed, the airline won't rebook you"
            )
            score += 40
        
        # Carrier changes
        if seg.has_carrier_change:
            flags.append(f"Carrier change on {seg.origin}→{seg.destination} — bags may need to be rechecked")
            score += 15
        
        # Short connections
        if seg.has_short_connection:
            flags.append(f"Tight connection on {seg.origin}→{seg.destination} — under 60 minutes")
            score += 25
        
        # Check layovers
        for layover in seg.layovers:
            if layover.duration_minutes < 60:
                # Already flagged by has_short_connection, but add specifics
                pass
            elif layover.duration_minutes < 90 and layover.airport not in ["", None]:
                # International heuristic: treat connections < 90 min as tight
                # (Simplified: any non-trivial connection under 90 min)
                if score < 20:
                    flags.append(f"Connection at {layover.airport}: {layover.duration_minutes} min may be tight for international")
                    score += 10
            
            if layover.is_long and layover.duration_minutes > 480:  # 8+ hours
                flags.append(f"Overnight layover at {layover.airport} ({layover.duration_minutes // 60}h)")
                score += 5
    
    # Check if actual transfers needed (not direct usage — adds risk of timing)
    actual_xfers = [t for t in itinerary.transfers if not getattr(t, 'is_direct', False)]
    if actual_xfers:
        non_instant = [t for t in actual_xfers if "instant" not in (t.expected_transfer_time or "").lower()]
        if non_instant:
            flags.append("Point transfers may take 1-3 days — transfer before searching for award seats")
            score += 10
    
    # Determine level
    score = min(score, 100)
    if score >= 40:
        level = "high"
    elif score >= 20:
        level = "medium"
    else:
        level = "low"
    
    if not flags:
        flags.append("Low risk — single ticket, reasonable connections")
    
    return RiskAssessment(score=score, level=level, flags=flags)


def _generate_booking_details(
    itinerary: RankedItinerary,
    trip: dict,
) -> BookingDetails:
    """
    Task 1: Generate actionable booking details for an itinerary.
    Includes everything a user needs to book without guessing.
    """
    airlines = set()
    flight_numbers = []
    connection_airports = set()
    cabin = None
    departure_date = None
    return_date = None
    departure_time = None
    return_time = None
    origin_airport = None
    destination_airport = None
    
    for seg in itinerary.segments:
        if seg.type != "flight":
            continue
        
        if seg.airline:
            airlines.add(seg.airline)
        if seg.operating_airline and seg.operating_airline != seg.airline:
            airlines.add(seg.operating_airline)
        if seg.flight_number:
            flight_numbers.append(seg.flight_number)
        if seg.cabin_class:
            cabin = seg.cabin_class
        
        # Collect leg flight numbers too
        for leg in seg.legs:
            if leg.flight_number and leg.flight_number not in flight_numbers:
                flight_numbers.append(leg.flight_number)
            if leg.marketing_carrier:
                airlines.add(leg.marketing_carrier)
        
        # Track connection airports from layovers
        for layover in seg.layovers:
            if layover.airport:
                connection_airports.add(layover.airport)
    
    # Determine departure/return from trip data
    origin_airport = trip.get("origin", "")
    destinations = trip.get("destinations", [])
    if destinations:
        destination_airport = destinations[0]
    
    departure_date = trip.get("startDate") or trip.get("start_date")
    return_date = trip.get("endDate") or trip.get("end_date")
    
    # Get times from first/last segments
    flight_segs = [s for s in itinerary.segments if s.type == "flight"]
    if flight_segs:
        if flight_segs[0].departure_time:
            departure_time = flight_segs[0].departure_time
        if len(flight_segs) > 1 and flight_segs[-1].departure_time:
            return_time = flight_segs[-1].departure_time
    
    # Check if actual transfers are needed (not counting direct usage)
    actual_transfer_entries = [t for t in itinerary.transfers if not getattr(t, 'is_direct', False)]
    needs_transfer = len(actual_transfer_entries) > 0
    transfer_programs = []
    for t in actual_transfer_entries:
        src_name = _get_bank_display_name(t.source_program)
        tgt_name = _get_program_display_name(t.target_program)
        transfer_programs.append(f"{src_name} → {tgt_name}")
    
    # Build search hint
    airline_names = sorted(airlines)
    if airline_names and origin_airport and destination_airport:
        primary_airline = airline_names[0]
        search_hint = f"Search {primary_airline} for award flights {origin_airport} → {destination_airport}"
        if departure_date:
            search_hint += f" on {departure_date}"
    else:
        search_hint = "Search your airline's website for award availability"
    
    # Build checklist
    checklist = []
    step = 1
    
    if needs_transfer:
        for t in actual_transfer_entries:
            src_name = _get_bank_display_name(t.source_program)
            tgt_name = _get_program_display_name(t.target_program)
            checklist.append(BookingChecklistStep(
                step_number=step,
                title="Transfer Points",
                description=f"Transfer {t.points_to_transfer:,} points from {src_name} to {tgt_name}. Expected time: {t.expected_transfer_time}.",
                action_type="transfer",
                details={
                    "source": t.source_program,
                    "target": t.target_program,
                    "points": t.points_to_transfer,
                    "portal_url": t.portal_url,
                    "transfer_time": t.expected_transfer_time,
                },
            ))
            step += 1
    
    # Book flights step(s)
    for seg in flight_segs:
        program = seg.program or (airline_names[0] if airline_names else "airline")
        prog_name = _get_program_display_name(program) if seg.program else (airline_names[0] if airline_names else "the airline")
        desc = f"Book {seg.origin} → {seg.destination}"
        if seg.cabin_class:
            desc += f" ({seg.cabin_class})"
        if seg.points_used:
            desc += f" using {seg.points_used:,} points on {prog_name}"
        if seg.surcharge and seg.surcharge > 0:
            desc += f" + ${seg.surcharge:,.2f} taxes/fees"
        desc += "."
        
        booking_url = seg.booking_url or ""
        checklist.append(BookingChecklistStep(
            step_number=step,
            title="Book Flight",
            description=desc,
            action_type="book",
            details={
                "origin": seg.origin,
                "destination": seg.destination,
                "flight_numbers": [seg.flight_number] if seg.flight_number else [l.flight_number for l in seg.legs if l.flight_number],
                "cabin": seg.cabin_class,
                "booking_url": booking_url,
            },
        ))
        step += 1
    
    # Save confirmation step
    checklist.append(BookingChecklistStep(
        step_number=step,
        title="Save Confirmation",
        description="Screenshot your confirmation number, receipt, and e-ticket. Save it somewhere you won't lose it.",
        action_type="save",
        details={
            "what_to_save": [
                "Confirmation number / PNR",
                "Receipt with ticket cost",
                "E-ticket number (13 digits)",
                "Seat assignment (if applicable)",
            ],
        },
    ))
    step += 1
    
    # Monitor step
    checklist.append(BookingChecklistStep(
        step_number=step,
        title="Monitor Your Trip",
        description="We'll keep watching for schedule changes and better options. Sign in to enable monitoring.",
        action_type="monitor",
    ))
    
    return BookingDetails(
        airlines=sorted(airlines),
        flight_numbers=flight_numbers,
        departure_date=departure_date,
        return_date=return_date,
        departure_time=departure_time,
        return_time=return_time,
        origin_airport=origin_airport,
        destination_airport=destination_airport,
        connection_airports=sorted(connection_airports),
        cabin=cabin,
        total_points=itinerary.oop_metrics.total_points_used,
        total_taxes_fees=sum(
            (seg.surcharge or 0) for seg in itinerary.segments if seg.payment_method == "points"
        ),
        total_cash_price=itinerary.oop_metrics.total_cash_price,
        search_hint=search_hint,
        booking_checklist=checklist,
        needs_transfer=needs_transfer,
        transfer_programs=transfer_programs,
    )


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
    
    # Reconstruct decision summary, rejected alternatives, and booking details
    decision_summary = None
    ds_data = result.get("decision_summary")
    if ds_data:
        decision_summary = DecisionSummary(**ds_data)
    
    rejected_alternatives = []
    for ra_data in result.get("rejected_alternatives", []):
        rejected_alternatives.append(RejectedAlternative(**ra_data))
    
    booking_details = None
    bd_data = result.get("booking_details")
    if bd_data:
        booking_details = BookingDetails(**bd_data)
    
    return OptimizeSoloResponse(
        itineraries=itineraries,
        best_option=result.get("best_option"),
        warnings=result.get("warnings", []),
        global_insights=global_insights,
        risk_mode=result.get("risk_mode"),
        decision_summary=decision_summary,
        rejected_alternatives=rejected_alternatives,
        booking_details=booking_details,
        cached=True,
        computed_at=cached.get("computed_at", ""),
        expires_at=cached.get("expires_at", ""),
    )


@router.get("/optimization-cache/{trip_id}", response_model=OptimizeSoloResponse)
async def get_optimization_cache(
    trip_id: str,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Get cached optimization results for a trip.
    Returns 404 if no cache exists.
    """
    try:
        # Get trip to verify ownership (with anon fallback for pre-sign-in trips)
        trip = _get_trip_with_anon_fallback(trip_id, user_id, http_request)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Resolve the effective owner for points lookup
        effective_user_id = trip.get("createdBy", user_id)
        
        # Build cache key (simplified - assumes points haven't changed)
        points_summary = solo_trip_service.get_points(trip_id, effective_user_id)
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
        
    except PermissionError as e:
        raise HTTPException(status_code=403, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting optimization cache: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Lock Plan & Session Migration Endpoints
# ============================================================================

class LockPlanRequest(BaseModel):
    """Request to lock a plan."""
    itinerary_id: str
    itinerary_snapshot: Optional[Dict] = None


class LockPlanResponse(BaseModel):
    """Response from locking a plan."""
    ok: bool
    locked: bool
    message: str
    requires_sign_in: bool = False


class MigrateSessionRequest(BaseModel):
    """Request to migrate anonymous session data to user account."""
    anon_session_id: str


class MigrateSessionResponse(BaseModel):
    """Response from session migration."""
    ok: bool
    trips_migrated: int
    message: str


@router.post("/trips/{trip_id}/lock", response_model=LockPlanResponse)
async def lock_plan(
    trip_id: str,
    request: LockPlanRequest,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Lock a plan. 
    - Anonymous user → returns requires_sign_in=True
    - Authenticated user → saves the plan immediately
    """
    try:
        if is_anonymous(user_id):
            return LockPlanResponse(
                ok=True,
                locked=False,
                message="Sign in to lock this plan and keep watching for better options.",
                requires_sign_in=True,
            )
        
        # Save selection and mark as locked
        trip = solo_trip_service.get_solo_trip(trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Store the lock with snapshot
        if request.itinerary_snapshot:
            from ..schemas import SelectItineraryRequest
            solo_trip_service.select_itinerary(
                trip_id, user_id,
                SelectItineraryRequest(
                    itinerary_id=request.itinerary_id,
                    itinerary_snapshot=request.itinerary_snapshot,
                    cash_price_at_selection=request.itinerary_snapshot.get("oopMetrics", {}).get("totalCashPrice", 0),
                    out_of_pocket_at_selection=request.itinerary_snapshot.get("oopMetrics", {}).get("totalOutOfPocket", 0),
                )
            )
        
        return LockPlanResponse(
            ok=True,
            locked=True,
            message="Plan locked. We'll remember this and watch for better options.",
            requires_sign_in=False,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error locking plan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/migrate-session", response_model=MigrateSessionResponse)
async def migrate_anon_session(
    request: MigrateSessionRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Migrate anonymous session data to an authenticated user account.
    Called after sign-in when the user had anonymous trip data.
    
    No data loss: all trips and points from the anonymous session are 
    transferred to the authenticated user.
    """
    try:
        anon_id = request.anon_session_id
        if not anon_id.startswith("anon_"):
            anon_id = f"anon_{anon_id}"
        
        # Find all trips created by this anonymous session
        from ..repos.ddb import table, sanitize_for_dynamodb
        from ..config import TRIPS_TABLE, POINTS_TABLE
        from boto3.dynamodb.conditions import Attr
        
        trips_table = table(TRIPS_TABLE)
        
        # Scan for trips with this anon user
        # In production, you'd use a GSI. For now, scan is acceptable for < 100 trips.
        response = trips_table.scan(
            FilterExpression=Attr('createdBy').eq(anon_id)
        )
        
        migrated_count = 0
        for trip_item in response.get('Items', []):
            trip_id = trip_item.get('tripId')
            if trip_id:
                # Update trip ownership
                trips_table.update_item(
                    Key={'tripId': trip_id},
                    UpdateExpression='SET createdBy = :uid',
                    ExpressionAttributeValues={':uid': user_id}
                )
                
                # Update points ownership
                points_table = table(POINTS_TABLE)
                points_response = points_table.scan(
                    FilterExpression=Attr('tripId').eq(trip_id)
                )
                for point_item in points_response.get('Items', []):
                    user_program = point_item.get('userProgram', '')
                    if anon_id in user_program:
                        new_user_program = user_program.replace(anon_id, user_id)
                        # Delete old and create new entry
                        points_table.delete_item(
                            Key={'tripId': trip_id, 'userProgram': user_program}
                        )
                        point_item['userProgram'] = new_user_program
                        points_table.put_item(Item=sanitize_for_dynamodb(point_item))
                
                migrated_count += 1
        
        return MigrateSessionResponse(
            ok=True,
            trips_migrated=migrated_count,
            message=f"Successfully migrated {migrated_count} trip{'s' if migrated_count != 1 else ''} to your account.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error migrating session: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Share / Magic Link Endpoints (Phase 14)
# ============================================================================

class SharePlanRequest(BaseModel):
    """Request to share a plan via email."""
    trip_id: str
    email: str
    anon_session_id: Optional[str] = None


class SharePlanResponse(BaseModel):
    """Response from sharing a plan."""
    ok: bool
    message: str
    email_sent: bool = False
    share_token: Optional[str] = None  # For testing/debugging


class ClaimPlanRequest(BaseModel):
    """Request to claim a shared plan."""
    trip_id: str


class ClaimPlanResponse(BaseModel):
    """Response from claiming a plan."""
    ok: bool
    message: str


def _generate_share_token(trip_id: str, owner_id: str) -> str:
    """Generate a signed share token (HMAC-based, 7-day TTL)."""
    import hashlib
    import hmac
    import base64
    import json
    import time
    
    secret = os.environ.get("SHARE_TOKEN_SECRET", "tripy-share-secret-dev")
    payload = {
        "trip_id": trip_id,
        "owner_id": owner_id,
        "exp": int(time.time()) + (7 * 24 * 3600),  # 7 days
    }
    payload_b64 = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode()
    sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
    return f"{payload_b64}.{sig}"


def _verify_share_token(token: str) -> Optional[Dict]:
    """Verify and decode a share token. Returns payload or None."""
    import hashlib
    import hmac
    import base64
    import json
    import time
    
    try:
        parts = token.split(".")
        if len(parts) != 2:
            return None
        
        payload_b64, sig = parts
        secret = os.environ.get("SHARE_TOKEN_SECRET", "tripy-share-secret-dev")
        expected_sig = hmac.new(secret.encode(), payload_b64.encode(), hashlib.sha256).hexdigest()
        
        if not hmac.compare_digest(sig, expected_sig):
            return None
        
        payload = json.loads(base64.urlsafe_b64decode(payload_b64))
        
        # Check expiry
        if payload.get("exp", 0) < time.time():
            return None
        
        return payload
    except Exception:
        return None


@router.post("/share", response_model=SharePlanResponse)
async def share_plan(
    request: SharePlanRequest,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Share a plan via email magic link.
    No sign-in required. Creates a signed token that allows read-only access.
    """
    try:
        # Verify trip exists
        trip = solo_trip_service.get_solo_trip(request.trip_id, user_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Generate share token
        owner_id = user_id
        token = _generate_share_token(request.trip_id, owner_id)
        
        # Build share URL
        from ..config import FRONTEND_URL
        from ..services.email_service import send_magic_link_email, is_email_enabled
        share_url = f"{FRONTEND_URL}/solo/results?trip_id={request.trip_id}&share_token={token}"
        
        # Send email via the email service (graceful if SES not configured)
        email_sent = False
        if is_email_enabled():
            try:
                result = send_magic_link_email(
                    to_email=request.email,
                    magic_link=share_url,
                )
                email_sent = result.get("success", False)
                if not email_sent:
                    logger.warning(f"Email service returned failure: {result.get('error')}")
            except Exception as e:
                logger.warning(f"Failed to send share email: {e}")
        
        if not email_sent:
            logger.info(f"[share] Email not sent (SES not configured). Share URL: {share_url}")
        
        return SharePlanResponse(
            ok=True,
            message="Link sent! Check your email." if email_sent else "Email could not be sent. Please try again or check your email address.",
            email_sent=email_sent,
            share_token=token,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error sharing plan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/shared/{token}")
async def get_shared_plan(token: str):
    """
    Access a shared plan via magic link token.
    Read-only — does not expose other trips.
    """
    try:
        payload = _verify_share_token(token)
        if not payload:
            raise HTTPException(status_code=401, detail="Invalid or expired share link")
        
        trip_id = payload["trip_id"]
        owner_id = payload["owner_id"]
        
        # Get trip (using owner_id for lookup)
        trip = solo_trip_service.get_solo_trip(trip_id, owner_id)
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Get cached optimization if available
        points_summary = solo_trip_service.get_points(trip_id, owner_id)
        points_dict = {p.program: p.balance for p in (points_summary.items or [])}
        mode = trip.get("optimizationMode", "balanced")
        cache_key = solo_trip_service.compute_cache_key(trip_id, trip, points_dict, mode)
        cached = solo_trip_service.get_cached_optimization(trip_id, cache_key)
        
        optimization = None
        if cached and not solo_trip_service.is_cache_expired(cached):
            optimization = _build_response_from_cached(cached).model_dump()
        
        # Return trip + optimization (read-only view)
        from ..mappers.trip_mapper import trip_storage_to_response
        trip_response = trip_storage_to_response(trip)
        
        return {
            "ok": True,
            "trip": trip_response.model_dump(),
            "optimization": optimization,
            "read_only": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error accessing shared plan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/claim", response_model=ClaimPlanResponse)
async def claim_plan(
    request: ClaimPlanRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Claim a shared plan to the authenticated user's account.
    Reassigns trip ownership.
    """
    try:
        # Get trip (without user check — we need to reassign)
        from ..repos.ddb import table
        from ..config import TRIPS_TABLE
        
        trips_table = table(TRIPS_TABLE)
        response = trips_table.get_item(Key={'tripId': request.trip_id})
        trip = response.get('Item')
        
        if not trip:
            raise HTTPException(status_code=404, detail="Trip not found")
        
        # Update ownership
        trips_table.update_item(
            Key={'tripId': request.trip_id},
            UpdateExpression='SET createdBy = :uid',
            ExpressionAttributeValues={':uid': user_id}
        )
        
        return ClaimPlanResponse(
            ok=True,
            message="Plan claimed to your account. You can now save, monitor, and manage it.",
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error claiming plan: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# ============================================================================
# Transfer Strategy Endpoint
# ============================================================================

@router.post("/transfer-strategy", response_model=TransferStrategyResponse)
async def get_transfer_strategy(
    request: TransferStrategyRequest,
    http_request: Request,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Get transfer strategy and booking instructions for a selected itinerary.
    Generates real booking steps from the itinerary snapshot.
    """
    try:
        # Get selection to verify it exists — try authenticated user, then anon fallback
        selection = None
        try:
            selection = solo_trip_service.get_selection(request.trip_id, user_id)
        except PermissionError:
            anon_id = http_request.headers.get("X-Anon-Session-Id")
            if anon_id and anon_id.startswith("anon_"):
                selection = solo_trip_service.get_selection(request.trip_id, anon_id)
        if not selection:
            raise HTTPException(status_code=404, detail="No selection found. Please select an itinerary first.")
        
        if selection.get("itinerary_id") != request.itinerary_id:
            raise HTTPException(status_code=400, detail="Itinerary ID does not match selection")
        
        # Extract itinerary snapshot
        snapshot = selection.get("itinerary_snapshot", {})
        snapshot = normalize_snapshot(snapshot)
        errors = validate_snapshot(snapshot)
        if errors:
            logger.warning(f"[transfer-strategy] Snapshot validation warnings (proceeding anyway): {errors}")
        
        # Debug: log what we received in the snapshot
        logger.info(f"[transfer-strategy] Snapshot keys: {list(snapshot.keys()) if snapshot else 'None'}")
        logger.info(f"[transfer-strategy] Snapshot transfers count: {len(snapshot.get('transfers', []))}")
        
        # Debug: dump first segment to see full structure
        snapshot_segments = snapshot.get("segments", [])
        if snapshot_segments:
            first_seg = snapshot_segments[0]
            logger.info(f"[transfer-strategy] FIRST SEGMENT KEYS: {list(first_seg.keys()) if isinstance(first_seg, dict) else 'not a dict'}")
            logger.info(f"[transfer-strategy] FIRST SEGMENT DUMP: {first_seg}")
        
        # Generate transfer instructions from snapshot
        transfers = []
        bookings = []
        total_points = 0
        max_time_days = 0
        
        # Load user's available bank programs for rerouting invalid transfers
        user_banks: list[str] = []
        try:
            points_data = solo_trip_service.get_points(request.trip_id, user_id)
            for item in (points_data.items or []):
                prog = item.get("program", "") if isinstance(item, dict) else getattr(item, "program", "")
                bal = item.get("balance", 0) if isinstance(item, dict) else getattr(item, "balance", 0)
                if bal and int(bal) > 0:
                    user_banks.append(prog)
        except Exception as e:
            logger.warning(f"[transfer-strategy] Could not load user points for validation: {e}")
        
        logger.info(f"[transfer-strategy] User banks for validation: {user_banks}")
        
        # Process transfers from snapshot - validate and reroute invalid ones
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
            
            # Validate and reroute invalid transfers
            if not _is_valid_transfer(source, target):
                old_source = source
                valid_bank = _find_valid_source_bank(target, user_banks)
                if valid_bank:
                    source = valid_bank
                    bank_norm = _normalize_bank_for_validation(valid_bank)
                    prog_norm = _normalize_program_for_validation(target)
                    partner_info = EXTENDED_TRANSFER_GRAPH.get(bank_norm, {}).get(prog_norm, {})
                    if isinstance(partner_info, dict):
                        ratio = partner_info.get("ratio", 1.0)
                    portal = BANK_METADATA.get(bank_norm, {}).get("portal_url", portal)
                    logger.info(f"[transfer-strategy] Rerouted invalid transfer {old_source} -> {target} to use {source}")
                else:
                    source_name = _get_bank_display_name(source)
                    target_name = _get_program_display_name(target)
                    warning = f"⚠️ None of your cards can transfer to {target_name}. You may need a different credit card program."
                    logger.warning(f"[transfer-strategy] No valid source bank for {target} among user banks {user_banks}. Skipping transfer.")
                    continue
            
            # Skip invalid transfers with 0 points
            if points <= 0:
                continue
            
            # Check if this is a direct usage (source == target means native miles)
            is_direct = t.get("isDirect") or t.get("is_direct", False)
            
            # Multi-payer: extract payer info from snapshot transfer
            payer_id = t.get("payerId") or t.get("payer_id")
            payer_name = t.get("payerName") or t.get("payer_name")
            
            # Enrich with live transfer bonus data
            bonus_percentage = None
            bonus_end_date = None
            try:
                from ..services.transfer_bonus_scraper import get_bonus_for_transfer
                bonus_record = get_bonus_for_transfer(source, target)
                if bonus_record:
                    bonus_percentage = bonus_record.bonus_pct
                    bonus_end_date = bonus_record.end_date.isoformat() if bonus_record.end_date else None
            except Exception:
                pass

            transfers.append(TransferInstruction(
                step_number=idx + 1,
                source_program=source,
                target_program=target,
                points_to_transfer=points,
                transfer_ratio=ratio,
                expected_transfer_time=time_str,
                portal_url=portal,
                warning=warning,
                is_direct=is_direct,
                payer_id=payer_id,
                payer_name=payer_name,
                bonus_percentage=bonus_percentage,
                bonus_end_date=bonus_end_date,
            ))
            
            # Only count actual transfers (not direct usage) toward total_points_to_transfer
            if not is_direct:
                total_points += points
            
            # Parse time for estimate
            if "day" in time_str.lower():
                try:
                    days = int(''.join(filter(str.isdigit, time_str.split('-')[-1])))
                    max_time_days = max(max_time_days, days)
                except:
                    max_time_days = max(max_time_days, 2)
        
        # Generate booking steps from flight segments only
        segments = snapshot.get("segments", [])
        step_num = len(transfers) + 1
        
        logger.info(f"[transfer-strategy] Processing {len(segments)} segments")
        
        for seg in segments:
            seg_type = seg.get("type", "flight")
            
            # Skip non-flight segments
            if seg_type != "flight":
                continue
            
            # Debug: log all segment keys for diagnosis
            logger.info(f"[transfer-strategy] Flight segment keys: {list(seg.keys())}")
            logger.info(f"[transfer-strategy] Flight segment raw: origin={seg.get('origin')}, destination={seg.get('destination')}")
            logger.info(f"[transfer-strategy]   airline={seg.get('airline')}, flightNumber={seg.get('flightNumber') or seg.get('flight_number')}")
            logger.info(f"[transfer-strategy]   operatingAirline={seg.get('operatingAirline') or seg.get('operating_airline')}")
            logger.info(f"[transfer-strategy]   stops={seg.get('stops')}, legs={seg.get('legs')}, layovers={seg.get('layovers')}")
            logger.info(f"[transfer-strategy]   payment obj={seg.get('payment')}")
            logger.info(f"[transfer-strategy]   cashPrice={seg.get('cashPrice') or seg.get('cash_price')}")
            logger.info(f"[transfer-strategy]   pointsUsed={seg.get('pointsUsed') or seg.get('points_used')}")
            logger.info(f"[transfer-strategy]   paymentMethod={seg.get('paymentMethod') or seg.get('payment_method')}")
            logger.info(f"[transfer-strategy]   program={seg.get('program')}")
            
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
            raw_program = seg.get("program") or payment.get("program", "")
            
            # Cross-reference with validated transfers to get the correct booking program.
            # The segment's raw program may be an operating carrier (e.g., "united" for a
            # codeshare), while the actual booking program is the transfer target (e.g., "aeroplan").
            program = raw_program
            if payment_method == "points" and transfers:
                prog_norm = _normalize_program_for_validation(raw_program)
                matched_transfer = next(
                    (t for t in transfers if _normalize_program_for_validation(t.target_program) == prog_norm),
                    None
                )
                if matched_transfer:
                    program = matched_transfer.target_program
                elif raw_program:
                    # No matching transfer found - check if the raw program is reachable from user's banks
                    valid_bank = _find_valid_source_bank(raw_program, user_banks) if user_banks else None
                    if not valid_bank:
                        logger.warning(
                            f"[transfer-strategy] Segment program '{raw_program}' has no valid transfer "
                            f"source from user banks {user_banks}. Falling back to cash display."
                        )
                        payment_method = "cash"
            
            airline = seg.get("airline", "Airline")
            origin = seg.get("origin", "")
            destination = seg.get("destination", "")
            cabin = seg.get("cabinClass") or seg.get("cabin_class") or seg.get("cabin", "Economy")
            departure = seg.get("departureTime") or seg.get("departure_time", "")
            arrival = seg.get("arrivalTime") or seg.get("arrival_time", "")
            flight_num = seg.get("flightNumber") or seg.get("flight_number", "")
            duration = seg.get("durationMinutes") or seg.get("duration_minutes")
            booking_url = seg.get("bookingUrl") or seg.get("booking_url", "")
            cash_price_raw = seg.get("cashPrice") or seg.get("cash_price") or payment.get("amount") or 0
            cash_price = float(cash_price_raw) if cash_price_raw else 0.0  # Handle Decimal from DynamoDB
            
            # Fallback for cash bookings with missing price: use oopMetrics from snapshot
            # This handles legacy snapshots where cashPrice was saved as 0
            if cash_price == 0 and payment_method == "cash":
                oop_metrics = snapshot.get("oopMetrics", {}) or snapshot.get("oop_metrics", {})
                total_cash = float(oop_metrics.get("totalCashPrice", 0) or oop_metrics.get("total_cash_price", 0) or 0)
                total_oop = float(oop_metrics.get("totalOutOfPocket", 0) or oop_metrics.get("total_out_of_pocket", 0) or 0)
                # Use totalOutOfPocket divided by cash segments count, or totalCashPrice as last resort
                cash_segment_count = sum(
                    1 for s in segments 
                    if s.get("type", "flight") == "flight" and (
                        (s.get("paymentMethod") or s.get("payment_method", "")) == "cash"
                    )
                )
                if total_oop > 0 and cash_segment_count > 0:
                    cash_price = total_oop / cash_segment_count
                elif total_cash > 0 and len(segments) > 0:
                    cash_price = total_cash / len(segments)
                logger.info(f"[transfer-strategy] Cash price was 0 for {origin}->{destination}, fallback to ${cash_price:.0f} from oopMetrics")
            
            operating_airline = seg.get("operatingAirline") or seg.get("operating_airline", "")
            
            # Extract connection details - CRITICAL for multi-leg flights
            stops = seg.get("stops", 0)
            raw_legs = seg.get("legs", [])
            raw_layovers = seg.get("layovers", [])
            
            # Convert legs to FlightLegDetail objects
            from ..schemas.optimize import FlightLegDetail, LayoverDetail
            legs = []
            for leg_data in raw_legs:
                if isinstance(leg_data, dict):
                    legs.append(FlightLegDetail(
                        origin=leg_data.get("origin", ""),
                        destination=leg_data.get("destination", ""),
                        departure_time=leg_data.get("departureTime") or leg_data.get("departure_time"),
                        arrival_time=leg_data.get("arrivalTime") or leg_data.get("arrival_time"),
                        duration_minutes=leg_data.get("durationMinutes") or leg_data.get("duration_minutes"),
                        flight_number=leg_data.get("flightNumber") or leg_data.get("flight_number", ""),
                        marketing_carrier=leg_data.get("marketingCarrier") or leg_data.get("marketing_carrier", ""),
                        operating_carrier=leg_data.get("operatingCarrier") or leg_data.get("operating_carrier"),
                    ))
            
            # Convert layovers to LayoverDetail objects
            layovers = []
            for lay_data in raw_layovers:
                if isinstance(lay_data, dict):
                    duration_mins = lay_data.get("durationMinutes") or lay_data.get("duration_minutes", 0)
                    layovers.append(LayoverDetail(
                        airport=lay_data.get("airport", ""),
                        airport_name=lay_data.get("airportName") or lay_data.get("airport_name"),
                        duration_minutes=duration_mins,
                        is_short=duration_mins < 60,
                        is_long=duration_mins > 240,
                    ))
            
            # Build segment reference (simple - codeshare shown separately)
            segment_ref = f"{origin} → {destination} {cabin} on {airline}"
            
            # Build booking URL: prefer a deep link with pre-filled search params
            # so the user lands directly on the award search results page.
            is_award = payment_method == "points"
            if not booking_url:
                # 1. Try deep link for the booking program (e.g. "UA" for United)
                if program:
                    booking_url = _build_booking_deep_link(
                        program, origin, destination, departure, cabin, is_award
                    )
                # 2. Try deep link for the airline code
                if not booking_url and airline:
                    booking_url = _build_booking_deep_link(
                        airline, origin, destination, departure, cabin, is_award
                    )
                # 3. Try marketing carrier from flight number (e.g. "UA123" → "UA")
                if not booking_url and flight_num and len(flight_num) >= 2:
                    carrier_code = flight_num[:2].upper()
                    booking_url = _build_booking_deep_link(
                        carrier_code, origin, destination, departure, cabin, is_award
                    )
            # 4. Fallback to generic booking page from PROGRAM_METADATA
            if not booking_url and program:
                prog_meta = PROGRAM_METADATA.get(program.upper(), {})
                booking_url = prog_meta.get("booking_url", "")
            if not booking_url:
                airline_meta = PROGRAM_METADATA.get(airline.upper(), {})
                booking_url = airline_meta.get("booking_url", "")
            if not booking_url and flight_num and len(flight_num) >= 2:
                carrier_code = flight_num[:2].upper()
                carrier_meta = PROGRAM_METADATA.get(carrier_code, {})
                booking_url = carrier_meta.get("booking_url", "")
            
            # Ensure cash_price is valid (not 0 for cash bookings)
            display_cash_price = cash_price if cash_price and cash_price > 0 else None
            
            # Determine payment reason
            payment_reason = None
            if payment_method == "points":
                # Using points - explain the value
                if points_used and surcharge is not None:
                    payment_reason = f"Using {points_used:,} points + ${surcharge:.0f} taxes/fees"
                elif points_used:
                    payment_reason = f"Using {points_used:,} points"
            else:
                # Using cash - explain why not points
                payment_reason_detail = seg.get("paymentReason") or seg.get("payment_reason") or payment.get("reason")
                if payment_reason_detail:
                    payment_reason = payment_reason_detail
                elif display_cash_price:
                    payment_reason = f"Cash booking at ${display_cash_price:.0f} - best value for this route"
                else:
                    payment_reason = "Cash booking - no award availability or better value than points"
            
            # Update segment reference to show full route if connecting flight
            if stops > 0 and legs:
                route_airports = [legs[0].origin] + [leg.destination for leg in legs]
                segment_ref = f"{' → '.join(route_airports)} {cabin} on {airline}"
            
            booking_step = BookingStep(
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
                # CRITICAL: Connection details for multi-leg flights
                stops=stops,
                legs=legs,
                layovers=layovers,
                # Payment details
                payment_method=payment_method,
                points_used=points_used if payment_method == "points" else None,
                cash_price=display_cash_price,
                surcharge=surcharge if payment_method == "points" else None,
                program=program if payment_method == "points" else None,
                payment_reason=payment_reason,
            )
            
            # Debug: log the built booking step
            logger.info(f"[transfer-strategy] Built BookingStep: origin={origin}, dest={destination}")
            logger.info(f"[transfer-strategy]   airline={airline}, flight_num={flight_num}, operating={operating_airline}")
            logger.info(f"[transfer-strategy]   stops={stops}, legs_count={len(legs)}, layovers_count={len(layovers)}")
            logger.info(f"[transfer-strategy]   payment={payment_method}, points={points_used}, surcharge={surcharge}, program={program}")
            if legs:
                for i, leg in enumerate(legs):
                    logger.info(f"[transfer-strategy]     leg[{i}]: {leg.origin}->{leg.destination} flight={leg.flight_number} marketing={leg.marketing_carrier} operating={leg.operating_carrier}")
            
            bookings.append(booking_step)
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


# ============================================================================
# Internal Cron — Scheduled Email Triggers
# ============================================================================
# Protected by a shared secret (CRON_SECRET env var).
# Designed to be called by EventBridge Scheduler → HTTP target, or a Lambda.
# Call: POST /solo/internal/send-scheduled-emails
#       Header: X-Cron-Secret: <value of CRON_SECRET>

from fastapi import Header, Request as FastAPIRequest


class CronEmailResult(BaseModel):
    """Summary of a cron email run."""
    ok: bool
    followup_sent: int = 0
    lock_prompt_sent: int = 0
    support_touch_sent: int = 0
    gentle_nudge_sent: int = 0
    errors: list = []


@router.post("/internal/send-scheduled-emails", response_model=CronEmailResult)
async def send_scheduled_emails(
    x_cron_secret: str = Header(..., alias="X-Cron-Secret"),
):
    """
    Internal endpoint — runs all scheduled email jobs.
    Protected by X-Cron-Secret header. Not meant for end users.
    
    Jobs:
      1. post_result_followup — user got results 24-72h ago, hasn't booked
      2. lock_plan_prompt     — auth user got results 2-48h ago, didn't lock/select
      3. support_touch        — auth user's first trip was 24-72h ago
      4. gentle_nudge         — anon user with 2+ trips (needs email from share history)
    """
    # Validate cron secret
    from ..config import CRON_SECRET
    if not CRON_SECRET or x_cron_secret != CRON_SECRET:
        raise HTTPException(status_code=403, detail="Invalid cron secret")

    from ..services.user_service import get_user
    from ..services.email_service import (
        send_post_result_followup_email,
        send_lock_plan_prompt_email,
        send_support_touch_email,
        is_email_enabled,
    )
    from ..config import FRONTEND_URL

    if not is_email_enabled():
        return CronEmailResult(ok=True, errors=["SES not configured — skipped all jobs"])

    result = CronEmailResult(ok=True)

    # ---- Job 1: Post-result follow-up ----
    try:
        trips = solo_trip_service.find_trips_for_followup()
        for trip in trips:
            try:
                user = get_user(trip['createdBy'])
                email = user.get('email') if user else None
                if not email:
                    continue
                trip_id = trip['tripId']
                magic_link = f"{FRONTEND_URL}/solo/results?trip_id={trip_id}"
                send_result = send_post_result_followup_email(to_email=email, magic_link=magic_link)
                if send_result.get('success'):
                    solo_trip_service.mark_email_sent(trip_id, 'emailFollowupSent')
                    result.followup_sent += 1
                else:
                    result.errors.append(f"followup:{trip_id}:{send_result.get('error')}")
            except Exception as e:
                result.errors.append(f"followup:{trip.get('tripId')}:{str(e)}")
    except Exception as e:
        result.errors.append(f"followup_query:{str(e)}")

    # ---- Job 2: Lock plan prompt ----
    try:
        trips = solo_trip_service.find_unlocked_trips_for_prompt()
        for trip in trips:
            try:
                user = get_user(trip['createdBy'])
                email = user.get('email') if user else None
                if not email:
                    continue
                trip_id = trip['tripId']
                lock_link = f"{FRONTEND_URL}/solo/results?trip_id={trip_id}"
                send_result = send_lock_plan_prompt_email(to_email=email, lock_plan_link=lock_link)
                if send_result.get('success'):
                    solo_trip_service.mark_email_sent(trip_id, 'emailLockPromptSent')
                    result.lock_prompt_sent += 1
                else:
                    result.errors.append(f"lock_prompt:{trip_id}:{send_result.get('error')}")
            except Exception as e:
                result.errors.append(f"lock_prompt:{trip.get('tripId')}:{str(e)}")
    except Exception as e:
        result.errors.append(f"lock_prompt_query:{str(e)}")

    # ---- Job 3: Support touch (first-time auth users) ----
    try:
        users = solo_trip_service.find_first_time_users()
        for entry in users:
            try:
                user = get_user(entry['createdBy'])
                email = user.get('email') if user else None
                if not email:
                    continue
                send_result = send_support_touch_email(to_email=email)
                if send_result.get('success'):
                    # Mark on a trip so we don't resend (pick any trip by this user)
                    trips = solo_trip_service.find_trips_for_followup.__wrapped__ if hasattr(solo_trip_service.find_trips_for_followup, '__wrapped__') else None
                    # Simple: just mark the flag using a scan
                    _mark_support_touch_for_user(entry['createdBy'])
                    result.support_touch_sent += 1
                else:
                    result.errors.append(f"support_touch:{entry['createdBy']}:{send_result.get('error')}")
            except Exception as e:
                result.errors.append(f"support_touch:{entry.get('createdBy')}:{str(e)}")
    except Exception as e:
        result.errors.append(f"support_touch_query:{str(e)}")

    # ---- Job 4: Gentle nudge (repeat anon users) ----
    # Note: This only works for anon users who have shared their email via "Email Me This Plan".
    # We check if they have a share record with an email. If not, we skip them.
    # For now, this is a placeholder — it requires an email lookup table for anon users.
    # Logging for visibility.
    try:
        repeat_users = solo_trip_service.find_repeat_anonymous_users()
        if repeat_users:
            logger.info(f"[cron] Found {len(repeat_users)} repeat anon users for gentle_nudge, "
                        "but no email lookup table exists yet. Skipping.")
    except Exception as e:
        result.errors.append(f"gentle_nudge_query:{str(e)}")

    logger.info(
        f"[cron] Scheduled emails complete: "
        f"followup={result.followup_sent}, lock_prompt={result.lock_prompt_sent}, "
        f"support_touch={result.support_touch_sent}, gentle_nudge={result.gentle_nudge_sent}, "
        f"errors={len(result.errors)}"
    )
    return result


def _mark_support_touch_for_user(user_id: str):
    """Mark all trips by this user so the support_touch email isn't sent again."""
    t = solo_trip_service.get_solo_table()
    from boto3.dynamodb.conditions import Attr
    try:
        resp = t.scan(
            FilterExpression=Attr('createdBy').eq(user_id),
            ProjectionExpression='tripId',
            Limit=10,
        )
        for item in resp.get('Items', []):
            solo_trip_service.mark_email_sent(item['tripId'], 'emailSupportTouchSent')
    except Exception as e:
        logger.warning(f"_mark_support_touch_for_user error: {e}")


# =========================================================================
# User Feedback Endpoint
# =========================================================================

class FeedbackRequest(BaseModel):
    feedback: str
    trip_id: Optional[str] = None


@router.post("/feedback")
async def submit_feedback(
    body: FeedbackRequest,
    background_tasks: BackgroundTasks,
    user_id: str = Depends(get_user_or_anon_id),
):
    """
    Receive user feedback from the confidence prompt and email it to the team.
    Runs the email send in a background task so the user gets an instant response.
    """
    feedback_text = body.feedback.strip()
    if not feedback_text:
        raise HTTPException(status_code=400, detail="Feedback cannot be empty")

    FEEDBACK_RECIPIENT = "tripy@traveltripy.com"

    subject = "feedback-from-input-box"
    text_body = (
        f"New feedback from the results page:\n\n"
        f"---\n"
        f"{feedback_text}\n"
        f"---\n\n"
        f"User/session: {user_id}\n"
        f"Trip ID: {body.trip_id or 'N/A'}\n"
        f"Submitted at: {datetime.now(timezone.utc).isoformat()}\n"
    )
    html_body = (
        f'<div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">'
        f'<h2 style="color: #1E293B;">New User Feedback</h2>'
        f'<div style="background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 8px; padding: 16px; margin: 16px 0;">'
        f'<p style="color: #334155; white-space: pre-wrap;">{feedback_text}</p>'
        f'</div>'
        f'<table style="color: #64748B; font-size: 13px;">'
        f'<tr><td style="padding-right: 12px;"><strong>User/Session:</strong></td><td>{user_id}</td></tr>'
        f'<tr><td style="padding-right: 12px;"><strong>Trip ID:</strong></td><td>{body.trip_id or "N/A"}</td></tr>'
        f'<tr><td style="padding-right: 12px;"><strong>Submitted:</strong></td><td>{datetime.now(timezone.utc).isoformat()}</td></tr>'
        f'</table>'
        f'</div>'
    )

    def _send():
        try:
            from ..services.email_service import send_email
            result = send_email(
                to_email=FEEDBACK_RECIPIENT,
                subject=subject,
                html_body=html_body,
                text_body=text_body,
                reply_to=FEEDBACK_RECIPIENT,
            )
            if result.get("success"):
                logger.info(f"Feedback email sent for trip={body.trip_id} user={user_id}")
            else:
                logger.error(f"Feedback email failed: {result.get('error')}")
        except Exception as e:
            logger.error(f"Feedback email exception: {e}")

    background_tasks.add_task(_send)

    return {"ok": True, "message": "Feedback received — thank you!"}


# ============================================================================
# Transfer Bonuses Endpoint
# ============================================================================

@router.get("/transfer-bonuses")
async def get_transfer_bonuses():
    """
    Return current transfer bonuses scraped from NerdWallet.
    Used by the frontend to display bonus badges on transfer cards.
    """
    from ..services.transfer_bonus_scraper import get_active_bonuses, get_cache_info

    bonuses = get_active_bonuses()
    cache = get_cache_info()

    return {
        "bonuses": [
            {
                "bank_code": b.bank_code,
                "program_code": b.program_code,
                "bonus_pct": b.bonus_pct,
                "start_date": b.start_date.isoformat() if b.start_date else None,
                "end_date": b.end_date.isoformat() if b.end_date else None,
                "bank_display": b.bank_display,
                "program_display": b.program_display,
            }
            for b in bonuses
        ],
        "cache": cache,
    }


@router.post("/transfer-bonuses/refresh")
async def refresh_transfer_bonuses():
    """Force a refresh of transfer bonus data from NerdWallet."""
    from ..services.transfer_bonus_scraper import refresh_bonuses, get_cache_info

    await refresh_bonuses()
    cache = get_cache_info()
    return {"ok": True, "cache": cache}
