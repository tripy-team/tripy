"""
Adapter to integrate V3 solver with the existing orchestrator.

This module provides conversion functions between:
- Orchestrator data format → V3 TripPlanSpec
- V3 OptimizationResult → Orchestrator RankedItinerary

This allows the orchestrator to use the V3 solver without changing
the frontend API contract.
"""

import logging
import uuid
from datetime import datetime, date
from typing import List, Dict, Optional, Tuple

from .trip_spec import TripPlanSpec, Traveler, OrderedLeg, StaySegment
from .models_v3 import (
    FlightItineraryEdge, FlightSegment, AwardOption,
    HotelOption, RoomType, TransferPath,
    OptimizationResult, OptimizationStatus, Solution,
)
from .normalize import normalize_program, normalize_bank
from .solver_v3 import optimize_trip, Mode
from .validators import validate_connection_eligibility
from .validation_policy import STRICT_MVP_POLICY

logger = logging.getLogger(__name__)


# =============================================================================
# ORCHESTRATOR → V3 CONVERSION
# =============================================================================

def convert_trip_to_spec(
    trip_data: dict,
    segments: List[dict],
    user_points: Dict[str, int],
    user_id: str = "user",
) -> TripPlanSpec:
    """
    Convert orchestrator trip data to V3 TripPlanSpec.
    
    Args:
        trip_data: Trip data from database
        segments: List of segment dicts from _build_trip_segments
        user_points: User's points balances {program: balance}
        user_id: User identifier
    
    Returns:
        TripPlanSpec for V3 solver
    """
    
    # Separate points and banks
    points_balances = {}
    bank_balances = {}
    
    for prog, balance in user_points.items():
        normalized = normalize_program(prog)
        bank_normalized = normalize_bank(prog)
        
        logger.info(f"[V3 Adapter] Points: {prog} -> normalized={normalized}, bank={bank_normalized}")
        
        # Check if it's a bank (transferable) or airline/hotel program
        if bank_normalized in {"chase", "amex", "citi", "capital_one", "bilt"}:
            bank_balances[bank_normalized] = balance
            logger.info(f"[V3 Adapter] Added to bank_balances: {bank_normalized}={balance:,}")
        else:
            points_balances[normalized] = balance
            logger.info(f"[V3 Adapter] Added to points_balances: {normalized}={balance:,}")
    
    logger.info(f"[V3 Adapter] Final bank_balances: {bank_balances}")
    logger.info(f"[V3 Adapter] Final points_balances: {points_balances}")
    
    # Create single traveler (solo trip)
    traveler = Traveler(
        traveler_id=user_id,
        name="Traveler",
        home_airport=_get_home_airport(trip_data, segments),
        points_balances=points_balances,
        bank_balances=bank_balances,
    )
    
    # Build ordered legs and stay segments
    legs, stay_segments = _build_legs_and_segments(segments)
    
    return TripPlanSpec(
        trip_id=trip_data.get("trip_id", str(uuid.uuid4())),
        travelers=[traveler],
        legs=legs,
        stay_segments=stay_segments,
    )


def _get_home_airport(trip_data: dict, segments: List[dict]) -> str:
    """Extract home airport from trip data or segments."""
    
    # Try trip_data origin
    if trip_data.get("origin"):
        return trip_data["origin"]
    
    # Try first flight segment
    for seg in segments:
        if seg.get("type") == "flight" and seg.get("origin"):
            return seg["origin"]
    
    return "JFK"  # Default


def _build_legs_and_segments(
    segments: List[dict],
) -> Tuple[List[OrderedLeg], List[StaySegment]]:
    """
    Convert orchestrator segments to V3 legs and stay segments.
    
    The orchestrator alternates: flight, hotel, flight, hotel, ...
    We map flights to OrderedLeg and hotels to StaySegment.
    
    MULTI-AIRPORT SUPPORT: Segments can include allowed_origin_airports and
    allowed_destination_airports to specify which airports are valid for each leg.
    E.g., for Seattle, segment might have allowed_origin_airports=["SEA", "PAE"]
    """
    
    legs = []
    stays = []
    
    leg_id = 0
    segment_id = 0
    
    for seg in segments:
        if seg.get("type") == "flight":
            # Parse date
            date_str = seg.get("date", "")
            try:
                leg_date = datetime.strptime(date_str, "%Y-%m-%d").date()
            except:
                leg_date = date.today()
            
            # MULTI-AIRPORT SUPPORT: Extract allowed airports from segment
            allowed_origins = seg.get("allowed_origin_airports")
            allowed_dests = seg.get("allowed_destination_airports")
            
            # Convert to list if not already (handles both None and list cases)
            if allowed_origins and not isinstance(allowed_origins, list):
                allowed_origins = [allowed_origins]
            if allowed_dests and not isinstance(allowed_dests, list):
                allowed_dests = [allowed_dests]
            
            legs.append(OrderedLeg(
                leg_id=leg_id,
                origin_city=seg.get("origin", ""),
                destination_city=seg.get("destination", ""),
                earliest_departure=leg_date,
                latest_departure=leg_date,  # Single day for now
                traveler_ids=["user"],
                allowed_origin_airports=allowed_origins,
                allowed_destination_airports=allowed_dests,
            ))
            leg_id += 1
        
        elif seg.get("type") == "hotel":
            # Parse dates
            try:
                check_in = datetime.strptime(seg.get("check_in", ""), "%Y-%m-%d").date()
                check_out = datetime.strptime(seg.get("check_out", ""), "%Y-%m-%d").date()
            except:
                check_in = date.today()
                check_out = date.today()
            
            stays.append(StaySegment(
                segment_id=segment_id,
                city=seg.get("city", ""),
                check_in=check_in,
                check_out=check_out,
                traveler_ids=["user"],
            ))
            segment_id += 1
    
    return legs, stays


def convert_search_results_to_flights(
    search_results: dict,
    segments: List[dict],
) -> List[FlightItineraryEdge]:
    """
    Convert orchestrator search results to V3 FlightItineraryEdge list.
    
    Args:
        search_results: Dict of {segment_key: FlightSearchResult}
        segments: Original segment list
    
    Returns:
        List of FlightItineraryEdge for V3 solver
    """
    
    flights = []
    leg_id = 0
    
    for i, seg in enumerate(segments):
        if seg.get("type") != "flight":
            continue
        
        key = f"flight_{i}"
        result = search_results.get(key)
        
        if not result or not hasattr(result, "options"):
            leg_id += 1
            continue
        
        for j, opt in enumerate(result.options or []):
            edge = _convert_flight_option(opt, leg_id, j, seg)
            if edge:
                flights.append(edge)
        
        leg_id += 1
    
    return flights


def _convert_flight_option(
    opt,
    leg_id: int,
    option_idx: int,
    segment: dict,
) -> Optional[FlightItineraryEdge]:
    """
    Convert a FlightOption to FlightItineraryEdge.
    
    V4 changes:
    - Extract ALL segments, not just the first one
    - Extract raw provider data (offer_id, pricing_source, etc.)
    - Use num_stops_hint to prevent missing segments from looking direct
    - Let finalize_itinerary derive protection attributes
    """
    from .derivation import finalize_itinerary
    
    try:
        edge_id = f"flight_{leg_id}_{option_idx}"
        
        # Parse times
        try:
            dep_dt = datetime.fromisoformat(opt.departure_time) if opt.departure_time else datetime.now()
            arr_dt = datetime.fromisoformat(opt.arrival_time) if opt.arrival_time else dep_dt
        except:
            dep_dt = datetime.now()
            arr_dt = dep_dt
        
        # ═══════════════════════════════════════════════════════════════════
        # BUILD ALL SEGMENTS (not just first one!)
        # ═══════════════════════════════════════════════════════════════════
        
        flight_segments = []
        
        # Check if provider gives us detailed segment info
        if hasattr(opt, 'segments') and opt.segments:
            # Provider gave us segment details - use them
            for i, seg_data in enumerate(opt.segments):
                seg_dep = datetime.fromisoformat(seg_data.get('departure_time', '')) if seg_data.get('departure_time') else dep_dt
                seg_arr = datetime.fromisoformat(seg_data.get('arrival_time', '')) if seg_data.get('arrival_time') else arr_dt
                
                flight_seg = FlightSegment(
                    segment_id=f"seg_{i}",
                    flight_number=seg_data.get('flight_number', f"{opt.airline}{100 + i}"),
                    operating_carrier=seg_data.get('operating_carrier', opt.operating_airline or opt.airline or "UA"),
                    marketing_carrier=seg_data.get('marketing_carrier', opt.airline or "UA"),
                    origin=seg_data.get('origin', ''),
                    destination=seg_data.get('destination', ''),
                    departure=seg_dep,
                    arrival=seg_arr,
                    cabin=seg_data.get('cabin', opt.cabin_class),
                )
                flight_segments.append(flight_seg)
        else:
            # No segment details - create single segment from top-level data
            flight_seg = FlightSegment(
                segment_id="seg_0",
                flight_number=opt.flight_numbers[0] if opt.flight_numbers else f"{opt.airline}100",
                operating_carrier=opt.operating_airline or opt.airline or "UA",
                marketing_carrier=opt.airline or "UA",
                origin=opt.origin or segment.get("origin", ""),
                destination=opt.destination or segment.get("destination", ""),
                departure=dep_dt,
                arrival=arr_dt,
                cabin=opt.cabin_class,
            )
            flight_segments.append(flight_seg)
        
        # ═══════════════════════════════════════════════════════════════════
        # EXTRACT RAW PROVIDER DATA
        # ═══════════════════════════════════════════════════════════════════
        
        # Get num_stops from provider (CRITICAL: prevents missing segments from looking direct)
        num_stops_hint = getattr(opt, 'num_stops', None)
        if num_stops_hint is None and hasattr(opt, 'stops'):
            num_stops_hint = opt.stops
        
        # Get pricing artifacts
        offer_id = getattr(opt, 'offer_id', None) or getattr(opt, 'id', None)
        pricing_id = getattr(opt, 'pricing_id', None)
        fare_id = getattr(opt, 'fare_id', None)
        
        # Get pricing source
        pricing_source = getattr(opt, 'source', None) or getattr(opt, 'pricing_source', None)
        if not pricing_source:
            # Try to infer from other fields
            if hasattr(opt, 'provider'):
                pricing_source = opt.provider
        
        # ═══════════════════════════════════════════════════════════════════
        # BUILD AWARD OPTIONS
        # ═══════════════════════════════════════════════════════════════════
        
        award_options = []
        if opt.award_available and opt.award_points and opt.award_points > 0:
            program = normalize_program(opt.award_program or "UA")
            award_options.append(AwardOption(
                option_id=f"{edge_id}_{program}",
                program=program,
                miles_required=opt.award_points,
                surcharge=opt.award_surcharge or 0.0,
                cabin_or_room_type=opt.cabin_class or "economy",
                cash_equivalent=opt.cash_price or 0.0,
            ))
        
        # ═══════════════════════════════════════════════════════════════════
        # CREATE EDGE (let derivation handle protection attributes)
        # ═══════════════════════════════════════════════════════════════════
        
        edge = FlightItineraryEdge(
            edge_id=edge_id,
            leg_id=leg_id,
            origin=opt.origin or segment.get("origin", ""),
            destination=opt.destination or segment.get("destination", ""),
            segments=flight_segments,
            departure_datetime=dep_dt,
            arrival_datetime=arr_dt,
            total_time_minutes=opt.duration_minutes or 180,
            cash_cost=opt.cash_price or 0.0,
            award_options=award_options,
            # V4: Raw data for derivation pipeline
            pricing_source=pricing_source,
            offer_id=offer_id,
            pricing_id=pricing_id,
            fare_id=fare_id,
            num_stops_hint=num_stops_hint,
            validating_carrier=getattr(opt, 'validating_carrier', None),
            # V4: Do NOT pre-set ticketing_type - let derivation handle it
        )
        
        edge.compute_date_fields()
        
        # V4: Run derivation pipeline
        edge = finalize_itinerary(edge)
        
        return edge
    
    except Exception as e:
        logger.warning(f"Failed to convert flight option: {e}")
        return None


def convert_search_results_to_hotels(
    search_results: dict,
    segments: List[dict],
) -> List[HotelOption]:
    """
    Convert orchestrator search results to V3 HotelOption list.
    """
    
    hotels = []
    segment_id = 0
    
    for i, seg in enumerate(segments):
        if seg.get("type") != "hotel":
            continue
        
        key = f"hotel_{i}"
        result = search_results.get(key)
        
        if not result or not hasattr(result, "options"):
            segment_id += 1
            continue
        
        for j, opt in enumerate(result.options or []):
            hotel = _convert_hotel_option(opt, segment_id, j)
            if hotel:
                hotels.append(hotel)
        
        segment_id += 1
    
    return hotels


def _convert_hotel_option(
    opt,
    segment_id: int,
    option_idx: int,
) -> Optional[HotelOption]:
    """Convert a HotelOption to V3 HotelOption."""
    
    try:
        hotel_id = f"hotel_{segment_id}_{option_idx}"
        
        # Build room types
        room_types = []
        
        # Cash room type
        cash_room = RoomType(
            room_type_id=f"{hotel_id}_cash",
            name=opt.room_type or "Standard",
            capacity=opt.guests or 2,
            cash_per_night=opt.cash_price_per_night or (opt.cash_price_total / max(opt.nights, 1) if opt.cash_price_total else 0),
        )
        room_types.append(cash_room)
        
        # Award room type (if available)
        if opt.award_available and opt.award_points_per_night:
            program = normalize_program(opt.award_program or "HYATT")
            award_room = RoomType(
                room_type_id=f"{hotel_id}_{program}",
                name=opt.room_type or "Award Room",
                capacity=opt.guests or 2,
                cash_per_night=opt.cash_price_per_night or 0,
                award_program=program,
                points_per_night=opt.award_points_per_night,
                award_surcharge_per_night=(opt.award_surcharge or 0) / max(opt.nights, 1),
            )
            room_types.append(award_room)
        
        return HotelOption(
            hotel_id=hotel_id,
            segment_id=segment_id,
            hotel_name=opt.name or "Hotel",
            chain=opt.brand or "Independent",
            star_rating=float(opt.star_rating or 4),
            room_types=room_types,
        )
    
    except Exception as e:
        logger.warning(f"Failed to convert hotel option: {e}")
        return None


def build_transfer_paths(user_points: Dict[str, int]) -> List[TransferPath]:
    """
    Build transfer paths based on user's bank balances.
    """
    
    from .constants import DEFAULT_TRANSFER_GRAPH
    
    paths = []
    
    for bank, targets in DEFAULT_TRANSFER_GRAPH.items():
        # Check if user has this bank
        normalized_bank = normalize_bank(bank)
        
        has_bank = False
        for prog in user_points.keys():
            if normalize_bank(prog) == normalized_bank:
                has_bank = True
                break
        
        if not has_bank:
            continue
        
        # Add transfer paths to each target
        for target, ratio in targets.items():
            normalized_target = normalize_program(target)
            paths.append(TransferPath(
                path_id=f"{normalized_bank}_to_{normalized_target}",
                from_bank=normalized_bank,
                to_program=normalized_target,
                min_increment=1000,
                ratio=ratio,
                current_bonus=1.0,
            ))
    
    return paths


# =============================================================================
# V3 → ORCHESTRATOR CONVERSION
# =============================================================================

def convert_result_to_itineraries(
    result: OptimizationResult,
    spec: TripPlanSpec,
    flights: List[FlightItineraryEdge],
    hotels: List[HotelOption],
    search_results: dict,
    segments: List[dict],
    budget: float,
) -> List:
    """
    Convert V3 OptimizationResult to orchestrator RankedItinerary list.
    
    Returns list of RankedItinerary objects (or dicts that match the format).
    """
    
    from ..agents.models import (
        RankedItinerary, OOPMetrics,
        FlightSegment as AgentFlightSegment,
        HotelSegment as AgentHotelSegment,
        CashPayment, PointsPayment, TransferInstruction,
    )
    
    if result.status not in {OptimizationStatus.OPTIMAL, OptimizationStatus.FEASIBLE_SUBOPTIMAL}:
        logger.warning(f"V3 solver returned {result.status}: {result.infeasibility_reason}")
        return []
    
    solution = result.solution
    if not solution:
        return []
    
    # Build flight/hotel lookup
    flight_by_id = {f.edge_id: f for f in flights}
    hotel_by_id = {h.hotel_id: h for h in hotels}
    
    # Build itinerary segments
    itinerary_segments = []
    route = []
    total_cash_price = 0.0
    total_oop = 0.0
    total_points_used = 0
    points_breakdown = {}
    transfers = []
    
    # Process flights
    for leg_id, edge_id in solution.selected_flights.items():
        flight = flight_by_id.get(edge_id)
        if not flight:
            continue
        
        payment_choice = solution.flight_payments.get(edge_id)
        
        if payment_choice and payment_choice.method == "points":
            # Points payment
            opt = next((o for o in flight.award_options if o.option_id == payment_choice.award_option_id), None)
            cpp = opt.cpp if opt else 0
            cash_saved = (flight.cash_cost - payment_choice.cash_amount) if opt else 0
            
            # Ensure program is never None
            program = (opt.program if opt and opt.program else None) or "unknown"
            
            payment = PointsPayment(
                program=program,
                points_used=payment_choice.points_amount,
                surcharge=payment_choice.cash_amount,
                cpp_achieved=cpp,
                cash_saved=cash_saved,
                reason=f"Saves ${cash_saved:.0f} at {cpp:.1f}¢/pt" if cpp else None,
            )
            
            total_oop += payment_choice.cash_amount
            total_points_used += payment_choice.points_amount
            prog = opt.program if opt else "unknown"
            points_breakdown[prog] = points_breakdown.get(prog, 0) + payment_choice.points_amount
            
            # Check for transfer
            if payment_choice.funding_source_id and "transfer" in payment_choice.funding_source_id:
                parts = payment_choice.funding_source_id.split("_")
                if len(parts) >= 4:
                    from_bank = parts[2]
                    to_prog = parts[3]
                    transfers.append(TransferInstruction(
                        from_program=from_bank,
                        to_program=to_prog,
                        points_to_transfer=payment_choice.points_amount,
                        ratio=1.0,
                        portal_url=f"https://{from_bank}.com/transfer",
                        transfer_time="Instant",
                        steps=[f"Transfer {payment_choice.points_amount:,} from {from_bank} to {to_prog}"],
                    ))
        else:
            # Cash payment
            payment = CashPayment(
                amount=flight.cash_cost,
                reason="Best value for this segment",
            )
            total_oop += flight.cash_cost
        
        total_cash_price += flight.cash_cost
        
        # Build segment
        seg = AgentFlightSegment(
            id=str(uuid.uuid4()),
            origin=flight.origin,
            destination=flight.destination,
            departure_time=flight.departure_datetime.isoformat() if flight.departure_datetime else None,
            arrival_time=flight.arrival_datetime.isoformat() if flight.arrival_datetime else None,
            duration_minutes=flight.total_time_minutes,
            airline=flight.segments[0].marketing_carrier if flight.segments else "UA",
            flight_number=flight.segments[0].flight_number if flight.segments else None,
            cabin_class=flight.segments[0].cabin if flight.segments else "Economy",
            cash_price=flight.cash_cost,
            payment=payment,
        )
        itinerary_segments.append(seg)
        
        if flight.origin not in route:
            route.append(flight.origin)
        route.append(flight.destination)
    
    # Process hotels
    for seg_id, hotel_id in solution.selected_hotels.items():
        hotel = hotel_by_id.get(hotel_id)
        if not hotel:
            continue
        
        # Get segment info for nights
        stay_seg = next((s for s in spec.stay_segments if s.segment_id == seg_id), None)
        nights = stay_seg.nights if stay_seg else 1
        
        # Get room count
        rooms = solution.selected_rooms.get(hotel_id, {})
        total_rooms = sum(rooms.values()) or 1
        
        payment_choice = solution.hotel_payments.get(hotel_id)
        
        # Find the room type used - match by award_option_id if using points
        room_type = None
        if payment_choice and payment_choice.method == "points" and payment_choice.award_option_id:
            # Find the room type that matches the ILP's choice
            logger.info(f"[V3 Adapter] Hotel {hotel_id}: Looking for room type '{payment_choice.award_option_id}'")
            logger.info(f"[V3 Adapter] Hotel {hotel_id}: Available room types: {[rt.room_type_id for rt in hotel.room_types]}")
            room_type = next(
                (rt for rt in hotel.room_types if rt.room_type_id == payment_choice.award_option_id),
                None
            )
            # If not found by ID, try to find any room type with award pricing
            if not room_type:
                logger.info(f"[V3 Adapter] Hotel {hotel_id}: Room type not found by ID, looking for any award room")
                room_type = next(
                    (rt for rt in hotel.room_types if rt.has_award_pricing),
                    None
                )
            if room_type:
                logger.info(f"[V3 Adapter] Hotel {hotel_id}: Found room type '{room_type.room_type_id}' with program '{room_type.award_program}'")
                logger.info(f"[V3 Adapter] Hotel {hotel_id}: payment funding_source_id='{payment_choice.funding_source_id}'")
        # Fall back to first room type for cash payments or if nothing found
        if not room_type:
            room_type = hotel.room_types[0] if hotel.room_types else None
            logger.info(f"[V3 Adapter] Hotel {hotel_id}: Fell back to room type '{room_type.room_type_id if room_type else None}'")
            
        cash_per_night = room_type.cash_per_night if room_type else 0
        cash_total = cash_per_night * nights * total_rooms
        
        total_cash_price += cash_total
        
        if payment_choice and payment_choice.method == "points":
            points_per_night = room_type.points_per_night if room_type and room_type.has_award_pricing else 0
            # Ensure program is never None - use the award_option_id to extract program if available
            program = None
            if room_type and room_type.award_program:
                program = room_type.award_program
            elif payment_choice.award_option_id:
                # Try to extract program from award_option_id (format: hotel_X_Y_PROGRAM)
                parts = payment_choice.award_option_id.split("_")
                if len(parts) >= 4:
                    program = parts[-1]  # Last part is typically the program
            program = program or "unknown"
            
            payment = PointsPayment(
                program=program,
                points_used=payment_choice.points_amount,
                surcharge=payment_choice.cash_amount,
                cpp_achieved=(cash_total - payment_choice.cash_amount) * 100 / payment_choice.points_amount if payment_choice.points_amount else 0,
                cash_saved=cash_total - payment_choice.cash_amount,
            )
            
            total_oop += payment_choice.cash_amount
            total_points_used += payment_choice.points_amount
            points_breakdown[program] = points_breakdown.get(program, 0) + payment_choice.points_amount
            
            # Check for transfer (same as flights)
            if payment_choice.funding_source_id and "transfer" in payment_choice.funding_source_id:
                parts = payment_choice.funding_source_id.split("_")
                if len(parts) >= 4:
                    from_bank = parts[2]
                    to_prog = parts[3]
                    transfers.append(TransferInstruction(
                        from_program=from_bank,
                        to_program=to_prog,
                        points_to_transfer=payment_choice.points_amount,
                        ratio=1.0,
                        portal_url=f"https://{from_bank}.com/transfer",
                        transfer_time="Instant",
                        steps=[f"Transfer {payment_choice.points_amount:,} from {from_bank} to {to_prog}"],
                    ))
                    logger.info(f"[V3 Adapter] Hotel transfer: {from_bank} -> {to_prog}: {payment_choice.points_amount:,} pts")
        else:
            payment = CashPayment(amount=cash_total)
            total_oop += cash_total
        
        seg = AgentHotelSegment(
            id=str(uuid.uuid4()),
            name=hotel.hotel_name,
            brand=hotel.chain,
            star_rating=int(hotel.star_rating),
            city=stay_seg.city if stay_seg else "",
            check_in=stay_seg.check_in.isoformat() if stay_seg else "",
            check_out=stay_seg.check_out.isoformat() if stay_seg else "",
            nights=nights,
            cash_price_per_night=cash_per_night,
            cash_price_total=cash_total,
            payment=payment,
        )
        itinerary_segments.append(seg)
    
    # Build metrics
    cash_saved = total_cash_price - total_oop
    savings_pct = (cash_saved / total_cash_price * 100) if total_cash_price > 0 else 0
    
    # Calculate average CPP
    cpp_values = []
    for seg in itinerary_segments:
        if hasattr(seg, "payment") and hasattr(seg.payment, "cpp_achieved") and seg.payment.cpp_achieved:
            cpp_values.append(seg.payment.cpp_achieved)
    avg_cpp = sum(cpp_values) / len(cpp_values) if cpp_values else 0
    
    itinerary = RankedItinerary(
        id=str(uuid.uuid4()),
        rank=1,
        name="V3 Optimized Itinerary",
        route=route,
        segments=itinerary_segments,
        oop_metrics=OOPMetrics(
            total_cash_price=total_cash_price,
            total_out_of_pocket=total_oop,
            total_points_used=total_points_used,
            cash_saved=cash_saved,
            savings_percentage=savings_pct,
            average_cpp=avg_cpp,
            points_breakdown=points_breakdown,
        ),
        transfers=transfers,
        within_budget=total_oop <= budget,
        within_points=True,
        summary=f"Save ${cash_saved:.0f} ({savings_pct:.0f}% off) by using {total_points_used:,} points",
    )
    
    # Debug log transfers
    logger.info(f"[V3 Adapter] Built itinerary with {len(transfers)} transfers, {len(itinerary_segments)} segments")
    if transfers:
        for t in transfers:
            logger.info(f"[V3 Adapter] Transfer: {t.from_program} -> {t.to_program}: {t.points_to_transfer:,} pts")
    else:
        logger.info(f"[V3 Adapter] No transfers - payments: {points_breakdown}")
    
    return [itinerary]


# =============================================================================
# MAIN ADAPTER FUNCTION
# =============================================================================

async def run_v3_optimization(
    segments: List[dict],
    search_results: dict,
    user_points: Dict[str, int],
    budget: float,
    trip_data: dict,
    mode: str = "oop",
) -> List:
    """
    Run V3 optimization using orchestrator data.
    
    This is the main entry point that:
    1. Converts orchestrator data to V3 format
    2. Runs the V3 solver
    3. Converts results back to orchestrator format
    
    Args:
        segments: List of segment dicts from orchestrator
        search_results: Search results from flight/hotel agents
        user_points: User's points balances
        budget: Cash budget
        trip_data: Trip data dict
        mode: Optimization mode ("oop", "cpp", "balanced")
    
    Returns:
        List of RankedItinerary objects
    """
    
    logger.info(f"[V3 Adapter] Starting V3 optimization, mode={mode}")
    
    # Convert to V3 format
    spec = convert_trip_to_spec(trip_data, segments, user_points)
    
    errors = spec.validate()
    if errors:
        logger.error(f"[V3 Adapter] Invalid spec: {errors}")
        return []
    
    flights = convert_search_results_to_flights(search_results, segments)
    hotels = convert_search_results_to_hotels(search_results, segments)
    transfers = build_transfer_paths(user_points)
    
    logger.info(f"[V3 Adapter] Converted: {len(flights)} flights, {len(hotels)} hotels, {len(transfers)} transfer paths")
    if transfers:
        for tp in transfers[:5]:  # Log first 5
            logger.info(f"[V3 Adapter] Transfer path: {tp.from_bank} -> {tp.to_program}")
    
    if not flights:
        logger.warning("[V3 Adapter] No flights to optimize")
        return []
    
    # Run V3 solver
    result = optimize_trip(
        spec=spec,
        flights=flights,
        hotels=hotels,
        transfers=transfers,
        mode=mode,
        determinism_mode=False,
    )
    
    logger.info(f"[V3 Adapter] V3 solver status: {result.status}")
    
    if result.warnings:
        for w in result.warnings[:5]:
            logger.warning(f"[V3 Adapter] {w}")
    
    # Convert back to orchestrator format
    itineraries = convert_result_to_itineraries(
        result=result,
        spec=spec,
        flights=flights,
        hotels=hotels,
        search_results=search_results,
        segments=segments,
        budget=budget,
    )
    
    logger.info(f"[V3 Adapter] Returning {len(itineraries)} itineraries")
    
    return itineraries
