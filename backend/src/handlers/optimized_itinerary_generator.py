"""
Optimized Itinerary Generator

Main orchestrator that generates optimized travel itineraries with guaranteed routes.
Key features:
- Always provides a bookable route (even if paying cash)
- Minimizes out-of-pocket costs when points are available
- Includes detailed flight booking instructions
- Supports multi-segment connecting flights
- Handles small airport hub fallbacks
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field, asdict
from datetime import datetime

from .flights import (
    get_flights_award_first_with_points_async,
    get_flights_serp_first_with_points_async,
    get_flights_serp_only,
)
from .min_oop_optimizer import (
    TripCostItem,
    PointsOption,
    MinOOPSolution,
    minimize_out_of_pocket,
    create_flight_cost_item,
    create_hotel_cost_item,
    solution_to_dict,
)
from .transfer_strategy import (
    EXTENDED_TRANSFER_GRAPH,
    BANK_METADATA,
    PROGRAM_METADATA,
    build_transfer_instruction,
    get_program_name,
    get_bank_name,
)
from .trip_cost_optimizer import aggregate_trip_costs

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES FOR OPTIMIZED ITINERARY
# =============================================================================

@dataclass
class FlightSegment:
    """Represents a single flight segment with booking details."""
    segment_id: str
    origin: str
    destination: str
    date: Optional[str] = None
    airline: Optional[str] = None
    airline_name: Optional[str] = None
    flight_number: Optional[str] = None
    departure_time: Optional[str] = None
    arrival_time: Optional[str] = None
    duration_minutes: Optional[int] = None
    
    # Pricing options
    cash_cost: Optional[float] = None
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    points_surcharge: Optional[float] = None
    transfer_options: List[Dict[str, Any]] = field(default_factory=list)
    
    # Booking info
    booking_url: Optional[str] = None
    is_connecting: bool = False
    connecting_airports: List[str] = field(default_factory=list)


@dataclass
class FlightRoute:
    """Complete flight route (may include multiple segments for connections)."""
    route_id: str
    origin: str
    destination: str
    segments: List[FlightSegment] = field(default_factory=list)
    
    # Overall costs
    total_cash_cost: float = 0.0
    total_points_cost: Optional[int] = None
    total_points_surcharge: Optional[float] = None
    points_program: Optional[str] = None
    
    # Metadata
    total_duration_minutes: int = 0
    num_stops: int = 0
    has_points_option: bool = False
    has_cash_option: bool = True  # Always true as we guarantee cash fallback


@dataclass 
class HotelOption:
    """Hotel booking option with pricing."""
    hotel_id: str
    name: str
    location: str
    check_in: Optional[str] = None
    check_out: Optional[str] = None
    nights: int = 1
    
    # Pricing
    cash_cost: float = 0.0
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    points_surcharge: Optional[float] = None
    
    # Booking info
    booking_url: Optional[str] = None
    rating: Optional[float] = None
    amenities: List[str] = field(default_factory=list)


@dataclass
class BookingInstruction:
    """Detailed booking instruction for a single item."""
    step_number: int
    item_type: str  # "transfer", "flight", "hotel"
    action: str
    description: str
    
    # Transfer details (if type is "transfer")
    from_program: Optional[str] = None
    to_program: Optional[str] = None
    points_to_transfer: Optional[int] = None
    transfer_ratio: Optional[str] = None
    transfer_time: Optional[str] = None
    portal_url: Optional[str] = None
    
    # Booking details (if type is "flight" or "hotel")
    booking_url: Optional[str] = None
    payment_type: Optional[str] = None  # "cash" or "points"
    cash_to_pay: Optional[float] = None
    points_to_use: Optional[int] = None
    
    # Flight-specific
    flight_details: Optional[Dict[str, Any]] = None
    
    # Hotel-specific
    hotel_details: Optional[Dict[str, Any]] = None


@dataclass
class OptimizedItinerary:
    """Complete optimized itinerary with all booking details."""
    status: str  # "Optimal", "Fallback", "Error"
    optimization_mode: str  # "oop" (minimize out-of-pocket)
    
    # Costs
    total_out_of_pocket: float = 0.0
    all_cash_cost: float = 0.0
    savings: float = 0.0
    savings_percentage: float = 0.0
    total_points_used: int = 0
    
    # Routes
    flights: List[FlightRoute] = field(default_factory=list)
    hotels: List[HotelOption] = field(default_factory=list)
    
    # Step-by-step instructions
    booking_instructions: List[BookingInstruction] = field(default_factory=list)
    
    # Transfer plan
    transfers: List[Dict[str, Any]] = field(default_factory=list)
    
    # Points summary
    points_breakdown: Dict[str, int] = field(default_factory=dict)
    points_remaining: Dict[str, int] = field(default_factory=dict)
    
    # Warnings/notes
    warnings: List[str] = field(default_factory=list)
    notes: List[str] = field(default_factory=list)


# =============================================================================
# SMALL AIRPORT HUB FALLBACK
# =============================================================================

# Regional airports -> nearby hubs for connecting flight fallback
SMALL_AIRPORT_NEARBY_HUBS: Dict[str, List[str]] = {
    # Northeast US
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "BUF", "EWR", "JFK"],           # Elmira, NY
    "AVP": ["PHL", "EWR", "JFK"],                  # Scranton/Wilkes-Barre, PA
    "SBY": ["BWI", "PHL", "DCA"],                  # Salisbury, MD
    
    # Southeast US  
    "CHA": ["ATL", "BNA", "CLT"],                  # Chattanooga, TN
    "TRI": ["CLT", "ATL", "BNA"],                  # Tri-Cities, TN/VA
    "AGS": ["ATL", "CLT", "JAX"],                  # Augusta, GA
    
    # Midwest US
    "BMI": ["ORD", "STL", "IND"],                  # Bloomington, IL
    "SBN": ["ORD", "DTW", "IND"],                  # South Bend, IN
    "MLI": ["ORD", "STL", "MSP"],                  # Quad Cities, IL
    
    # West US
    "SBA": ["LAX", "SFO", "SAN"],                  # Santa Barbara, CA
    "PSP": ["LAX", "SAN", "PHX"],                  # Palm Springs, CA
    "EUG": ["PDX", "SFO", "SEA"],                  # Eugene, OR
    
    # Mountain West
    "MTJ": ["DEN", "SLC", "PHX"],                  # Montrose, CO
    "JAC": ["SLC", "DEN", "SEA"],                  # Jackson Hole, WY
    "IDA": ["SLC", "DEN", "BOI"],                  # Idaho Falls, ID
}


def get_hub_airports_for_origin(origin: str) -> List[str]:
    """Get list of hub airports to try for a small regional airport."""
    return SMALL_AIRPORT_NEARBY_HUBS.get(origin.upper(), [])


# =============================================================================
# FLIGHT SEARCH WITH GUARANTEED ROUTES
# =============================================================================

async def search_flights_with_fallback(
    origin: str,
    destination: str,
    date_str: str,
    user_points: Dict[str, int],
    filters: Optional[Dict[str, Any]] = None,
) -> Tuple[Dict[Any, Dict[str, Any]], List[str]]:
    """
    Search for flights with automatic fallback strategies.
    
    Returns:
        Tuple of (edges_dict, warnings)
    
    Fallback order:
    1. AwardTool + SERP (award-first)
    2. SERP-only (cash flights)
    3. Hub fallback for small airports
    """
    warnings = []
    
    # Build filters
    filt = dict(filters or {})
    filt["outbound_date"] = date_str
    
    # Strategy 1: Award-first search
    try:
        edges = await get_flights_award_first_with_points_async(
            origin, destination, user_points, filt
        )
        if edges:
            logger.info(f"Found {len(edges)} edges via award-first for {origin}->{destination}")
            return edges, warnings
    except Exception as e:
        logger.warning(f"Award-first search failed for {origin}->{destination}: {e}")
        warnings.append(f"Award flight search unavailable, using cash flights")
    
    # Strategy 2: SERP-only (cash flights)
    try:
        edges = get_flights_serp_only(origin, destination, date_str, filt)
        if edges:
            logger.info(f"Found {len(edges)} cash-only edges for {origin}->{destination}")
            return edges, warnings
    except Exception as e:
        logger.warning(f"SERP-only search failed for {origin}->{destination}: {e}")
    
    # Strategy 3: Hub fallback for small airports
    hub_airports = get_hub_airports_for_origin(origin)
    if hub_airports:
        for hub in hub_airports[:3]:  # Try top 3 hubs
            try:
                hub_edges = await get_flights_award_first_with_points_async(
                    hub, destination, user_points, filt
                )
                if hub_edges:
                    logger.info(f"Found {len(hub_edges)} edges via hub {hub} for {origin}->{destination}")
                    warnings.append(
                        f"No direct flights from {origin}. Consider traveling to {hub} first, "
                        f"then flying to {destination}."
                    )
                    return hub_edges, warnings
            except Exception as e:
                logger.warning(f"Hub fallback via {hub} failed: {e}")
                continue
    
    # No routes found
    warnings.append(
        f"No flights found for {origin} to {destination} on {date_str}. "
        "Please check your dates or try alternative airports."
    )
    return {}, warnings


def build_flight_routes_from_edges(
    edges: Dict[Any, Dict[str, Any]],
    origin: str,
    destination: str,
    date_str: str,
) -> List[FlightRoute]:
    """
    Convert flight edges to FlightRoute objects with full booking details.
    Ensures every route has at least a cash option.
    """
    routes = []
    
    for edge_key, edge_data in edges.items():
        # Parse edge key (origin, dest, flight_number)
        if isinstance(edge_key, tuple) and len(edge_key) >= 3:
            e_origin, e_dest, flight_num = edge_key[0], edge_key[1], edge_key[2]
        else:
            continue
        
        # Skip if not matching our route
        if e_origin.upper() != origin.upper() or e_dest.upper() != destination.upper():
            continue
        
        # Build segment
        airline_code = edge_data.get("operating_airline") or edge_data.get("points_program") or ""
        airline_name = PROGRAM_METADATA.get(airline_code, {}).get("name", airline_code)
        booking_url = PROGRAM_METADATA.get(airline_code, {}).get("booking_url", "")
        
        segment = FlightSegment(
            segment_id=f"{e_origin}_{e_dest}_{flight_num}",
            origin=e_origin,
            destination=e_dest,
            date=date_str,
            airline=airline_code,
            airline_name=airline_name,
            flight_number=flight_num,
            departure_time=edge_data.get("departure_time"),
            arrival_time=edge_data.get("arrival_time"),
            duration_minutes=edge_data.get("time_cost"),
            cash_cost=edge_data.get("cash_cost"),
            points_cost=edge_data.get("points_cost"),
            points_program=edge_data.get("points_program"),
            points_surcharge=edge_data.get("points_surcharge"),
            transfer_options=edge_data.get("transfer_partners", []),
            booking_url=booking_url,
        )
        
        # Build route
        cash_cost = segment.cash_cost or 0.0
        has_points = segment.points_cost is not None and segment.points_cost > 0
        
        route = FlightRoute(
            route_id=f"route_{segment.segment_id}",
            origin=e_origin,
            destination=e_dest,
            segments=[segment],
            total_cash_cost=cash_cost,
            total_points_cost=segment.points_cost if has_points else None,
            total_points_surcharge=segment.points_surcharge if has_points else None,
            points_program=segment.points_program if has_points else None,
            total_duration_minutes=segment.duration_minutes or 0,
            num_stops=0,
            has_points_option=has_points,
            has_cash_option=cash_cost > 0,
        )
        
        routes.append(route)
    
    # Sort by best value: lowest OOP first (prefer points with low surcharge)
    def route_score(r: FlightRoute) -> float:
        if r.has_points_option and r.total_points_surcharge is not None:
            return r.total_points_surcharge
        return r.total_cash_cost or float('inf')
    
    routes.sort(key=route_score)
    
    return routes


# =============================================================================
# MAIN OPTIMIZATION FUNCTION
# =============================================================================

async def generate_optimized_itinerary(
    segments: List[Dict[str, Any]],
    user_points: Dict[str, int],
    hotels: Optional[List[Dict[str, Any]]] = None,
    include_hotels: bool = True,
    max_cash_budget: Optional[float] = None,
) -> OptimizedItinerary:
    """
    Generate an optimized itinerary with guaranteed bookable routes.
    
    Args:
        segments: List of flight segments needed, each with:
            - origin: Origin airport code
            - destination: Destination airport code
            - date: Travel date (YYYY-MM-DD)
        user_points: Dict of point balances by program
        hotels: Optional list of hotel options
        include_hotels: Whether to include hotels in optimization
        max_cash_budget: Optional maximum cash budget
        
    Returns:
        OptimizedItinerary with complete booking instructions
    """
    result = OptimizedItinerary(
        status="Optimal",
        optimization_mode="oop",
    )
    
    all_flight_routes: List[FlightRoute] = []
    all_edges: List[Dict[str, Any]] = []
    
    # Step 1: Search flights for each segment
    for i, seg in enumerate(segments):
        origin = seg.get("origin", "").upper()
        destination = seg.get("destination", "").upper()
        date_str = seg.get("date", "")
        
        if not origin or not destination:
            result.warnings.append(f"Segment {i+1}: Missing origin or destination")
            continue
        
        edges, warnings = await search_flights_with_fallback(
            origin, destination, date_str, user_points, seg.get("filters")
        )
        result.warnings.extend(warnings)
        
        if not edges:
            result.warnings.append(
                f"No flights found for {origin} to {destination}. "
                "This segment may need manual booking."
            )
            continue
        
        # Convert to FlightRoute objects
        routes = build_flight_routes_from_edges(edges, origin, destination, date_str)
        if routes:
            # Keep best route for this segment
            all_flight_routes.append(routes[0])
            
            # Build edge dict for optimizer
            best_route = routes[0]
            if best_route.segments:
                seg_data = best_route.segments[0]
                edge_dict = {
                    "origin": seg_data.origin,
                    "destination": seg_data.destination,
                    "date": date_str,
                    "cash_cost": seg_data.cash_cost or 0,
                    "points_cost": seg_data.points_cost,
                    "points_program": seg_data.points_program,
                    "points_surcharge": seg_data.points_surcharge or 0,
                    "airline": seg_data.airline,
                    "flight_number": seg_data.flight_number,
                }
                all_edges.append(edge_dict)
    
    result.flights = all_flight_routes
    
    # Step 2: Process hotels if included
    hotel_options = []
    if include_hotels and hotels:
        for h in hotels:
            hotel_options.append(h)
    
    # Step 3: Run optimization
    if all_edges or hotel_options:
        try:
            from .trip_cost_optimizer import aggregate_trip_costs, optimize_trip_out_of_pocket
            
            solution = await optimize_trip_out_of_pocket(
                flight_edges=all_edges,
                hotel_options=hotel_options,
                user_points=user_points,
                include_hotels=include_hotels,
                max_cash_budget=max_cash_budget,
            )
            
            # Extract solution data
            result.total_out_of_pocket = solution.total_out_of_pocket
            result.all_cash_cost = solution.all_cash_cost
            result.savings = solution.savings
            result.savings_percentage = solution.savings_percentage
            result.total_points_used = solution.total_points_used
            result.points_breakdown = dict(solution.points_breakdown)
            result.points_remaining = dict(solution.points_remaining)
            result.status = solution.status
            
            # Build transfer plan from solution
            result.transfers = [asdict(t) for t in solution.transfer_plan]
            
            # Build booking instructions
            result.booking_instructions = build_booking_instructions(
                solution, all_flight_routes, hotel_options
            )
            
        except Exception as e:
            logger.error(f"Optimization failed: {e}")
            result.status = "Fallback"
            result.warnings.append(f"Optimization unavailable: {e}. Showing cash prices.")
            
            # Calculate cash-only totals
            total_cash = sum(
                (r.total_cash_cost or 0) for r in all_flight_routes
            )
            result.total_out_of_pocket = total_cash
            result.all_cash_cost = total_cash
            
            # Build simple booking instructions
            result.booking_instructions = build_cash_only_instructions(
                all_flight_routes, hotel_options
            )
    
    # Add helpful notes
    if result.savings > 0:
        result.notes.append(
            f"By using your points optimally, you save ${result.savings:,.2f} "
            f"({result.savings_percentage:.1f}%) compared to paying all cash."
        )
    
    if result.transfers:
        instant_transfers = [t for t in result.transfers if "instant" in t.get("transfer_time", "").lower()]
        if instant_transfers:
            result.notes.append(
                f"{len(instant_transfers)} of your transfers are instant. "
                "You can book immediately after transferring."
            )
    
    return result


def build_booking_instructions(
    solution: MinOOPSolution,
    flight_routes: List[FlightRoute],
    hotel_options: List[Dict[str, Any]],
) -> List[BookingInstruction]:
    """Build step-by-step booking instructions from optimization solution."""
    instructions = []
    step = 1
    
    # Step 1: Transfers (do these first)
    for transfer in solution.transfer_plan:
        instructions.append(BookingInstruction(
            step_number=step,
            item_type="transfer",
            action=f"Transfer {transfer.points_to_transfer:,} points",
            description=(
                f"Transfer {transfer.points_to_transfer:,} {transfer.from_program_name} points "
                f"to {transfer.to_program_name} ({transfer.transfer_ratio} ratio)"
            ),
            from_program=transfer.from_program,
            to_program=transfer.to_program,
            points_to_transfer=transfer.points_to_transfer,
            transfer_ratio=transfer.transfer_ratio,
            transfer_time=transfer.transfer_time,
            portal_url=transfer.portal_url,
        ))
        step += 1
    
    # Step 2: Flight bookings
    for payment in solution.payment_plan:
        if payment.item_type != "flight":
            continue
        
        # Find matching flight route
        matching_route = None
        for route in flight_routes:
            if payment.item_id in route.route_id or payment.description in str(route):
                matching_route = route
                break
        
        if payment.payment_type == "points":
            instructions.append(BookingInstruction(
                step_number=step,
                item_type="flight",
                action=f"Book flight with {payment.points_used:,} points",
                description=(
                    f"Book {payment.description} using {payment.points_used:,} "
                    f"{payment.program_name} points. Pay ${payment.cash_paid:.2f} in taxes/fees."
                ),
                booking_url=PROGRAM_METADATA.get(payment.program_used, {}).get("booking_url"),
                payment_type="points",
                cash_to_pay=payment.cash_paid,
                points_to_use=payment.points_used,
                flight_details={
                    "description": payment.description,
                    "program": payment.program_name,
                } if matching_route else None,
            ))
        else:
            instructions.append(BookingInstruction(
                step_number=step,
                item_type="flight",
                action=f"Book flight with cash",
                description=f"Book {payment.description}. Pay ${payment.cash_paid:.2f} cash.",
                booking_url=None,  # Use Google Flights or airline website
                payment_type="cash",
                cash_to_pay=payment.cash_paid,
                flight_details={
                    "description": payment.description,
                } if matching_route else None,
            ))
        step += 1
    
    # Step 3: Hotel bookings
    for payment in solution.payment_plan:
        if payment.item_type != "hotel":
            continue
        
        if payment.payment_type == "points":
            instructions.append(BookingInstruction(
                step_number=step,
                item_type="hotel",
                action=f"Book hotel with {payment.points_used:,} points",
                description=(
                    f"Book {payment.description} using {payment.points_used:,} "
                    f"{payment.program_name} points. Pay ${payment.cash_paid:.2f} in fees."
                ),
                booking_url=PROGRAM_METADATA.get(payment.program_used, {}).get("booking_url"),
                payment_type="points",
                cash_to_pay=payment.cash_paid,
                points_to_use=payment.points_used,
            ))
        else:
            instructions.append(BookingInstruction(
                step_number=step,
                item_type="hotel",
                action=f"Book hotel with cash",
                description=f"Book {payment.description}. Pay ${payment.cash_paid:.2f} cash.",
                payment_type="cash",
                cash_to_pay=payment.cash_paid,
            ))
        step += 1
    
    return instructions


def build_cash_only_instructions(
    flight_routes: List[FlightRoute],
    hotel_options: List[Dict[str, Any]],
) -> List[BookingInstruction]:
    """Build simple cash-only booking instructions when optimization unavailable."""
    instructions = []
    step = 1
    
    for route in flight_routes:
        if route.segments:
            seg = route.segments[0]
            instructions.append(BookingInstruction(
                step_number=step,
                item_type="flight",
                action=f"Book {seg.origin} to {seg.destination}",
                description=(
                    f"Book {seg.airline_name or seg.airline or 'flight'} "
                    f"{seg.flight_number or ''} from {seg.origin} to {seg.destination}. "
                    f"Estimated cost: ${route.total_cash_cost:.2f}"
                ),
                booking_url=seg.booking_url,
                payment_type="cash",
                cash_to_pay=route.total_cash_cost,
                flight_details={
                    "origin": seg.origin,
                    "destination": seg.destination,
                    "airline": seg.airline,
                    "flight_number": seg.flight_number,
                    "date": seg.date,
                },
            ))
            step += 1
    
    for hotel in hotel_options:
        cash_cost = hotel.get("cash_cost") or hotel.get("price") or 0
        instructions.append(BookingInstruction(
            step_number=step,
            item_type="hotel",
            action=f"Book {hotel.get('name', 'hotel')}",
            description=(
                f"Book {hotel.get('name', 'hotel')} in {hotel.get('location', '')}. "
                f"Estimated cost: ${cash_cost:.2f}"
            ),
            payment_type="cash",
            cash_to_pay=cash_cost,
        ))
        step += 1
    
    return instructions


# =============================================================================
# SYNC WRAPPER
# =============================================================================

def generate_optimized_itinerary_sync(
    segments: List[Dict[str, Any]],
    user_points: Dict[str, int],
    hotels: Optional[List[Dict[str, Any]]] = None,
    include_hotels: bool = True,
    max_cash_budget: Optional[float] = None,
) -> OptimizedItinerary:
    """Synchronous wrapper for generate_optimized_itinerary."""
    return asyncio.run(generate_optimized_itinerary(
        segments, user_points, hotels, include_hotels, max_cash_budget
    ))


def itinerary_to_dict(itinerary: OptimizedItinerary) -> Dict[str, Any]:
    """Convert OptimizedItinerary to JSON-serializable dict."""
    return {
        "status": itinerary.status,
        "optimization_mode": itinerary.optimization_mode,
        "total_out_of_pocket": itinerary.total_out_of_pocket,
        "all_cash_cost": itinerary.all_cash_cost,
        "savings": itinerary.savings,
        "savings_percentage": itinerary.savings_percentage,
        "total_points_used": itinerary.total_points_used,
        "flights": [
            {
                "route_id": r.route_id,
                "origin": r.origin,
                "destination": r.destination,
                "total_cash_cost": r.total_cash_cost,
                "total_points_cost": r.total_points_cost,
                "total_points_surcharge": r.total_points_surcharge,
                "points_program": r.points_program,
                "total_duration_minutes": r.total_duration_minutes,
                "num_stops": r.num_stops,
                "has_points_option": r.has_points_option,
                "has_cash_option": r.has_cash_option,
                "segments": [asdict(s) for s in r.segments],
            }
            for r in itinerary.flights
        ],
        "hotels": itinerary.hotels,
        "booking_instructions": [asdict(i) for i in itinerary.booking_instructions],
        "transfers": itinerary.transfers,
        "points_breakdown": itinerary.points_breakdown,
        "points_remaining": itinerary.points_remaining,
        "warnings": itinerary.warnings,
        "notes": itinerary.notes,
        "summary": {
            "total_out_of_pocket": f"${itinerary.total_out_of_pocket:,.2f}",
            "all_cash_would_cost": f"${itinerary.all_cash_cost:,.2f}",
            "you_save": f"${itinerary.savings:,.2f}",
            "savings_percentage": f"{itinerary.savings_percentage:.1f}%",
            "total_points_used": f"{itinerary.total_points_used:,}",
        },
    }
