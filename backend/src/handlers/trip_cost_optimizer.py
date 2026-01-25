"""
Trip Cost Optimizer

Unified cost aggregation for flights and hotels.
Fetches all options and prepares data for the min_oop_optimizer.
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass, field

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
    get_transfer_partners,
    get_program_name,
)

logger = logging.getLogger(__name__)


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class TripCostSummary:
    """Summary of all trip costs ready for optimization."""
    all_items: List[TripCostItem] = field(default_factory=list)
    flight_items: List[TripCostItem] = field(default_factory=list)
    hotel_items: List[TripCostItem] = field(default_factory=list)
    available_points: Dict[str, int] = field(default_factory=dict)
    transfer_options: Dict[str, List[str]] = field(default_factory=dict)
    all_cash_total: float = 0.0


# =============================================================================
# COST AGGREGATION FUNCTIONS
# =============================================================================

async def aggregate_trip_costs(
    flight_edges: List[Dict[str, Any]],
    hotel_options: List[Dict[str, Any]],
    user_points: Dict[str, int],
) -> TripCostSummary:
    """
    Aggregate all flight and hotel options into TripCostItems.
    
    Args:
        flight_edges: List of flight edges from the ILP adapter
        hotel_options: List of hotel options from hotels.py
        user_points: User's point balances
        
    Returns:
        TripCostSummary with all items ready for optimization
    """
    flight_items = []
    hotel_items = []
    
    # Process flight edges
    for i, edge in enumerate(flight_edges):
        item = _edge_to_cost_item(edge, f"flight_{i}")
        if item:
            flight_items.append(item)
    
    # Process hotel options
    for i, hotel in enumerate(hotel_options):
        item = _hotel_to_cost_item(hotel, f"hotel_{i}")
        if item:
            hotel_items.append(item)
    
    # Build transfer options
    transfer_options = {}
    for prog, balance in user_points.items():
        if balance <= 0:
            continue
        prog_lower = prog.lower()
        if prog_lower in EXTENDED_TRANSFER_GRAPH:
            partners = get_transfer_partners(prog_lower)
            transfer_options[prog] = partners
    
    all_items = flight_items + hotel_items
    all_cash = sum(item.cash_cost for item in all_items)
    
    return TripCostSummary(
        all_items=all_items,
        flight_items=flight_items,
        hotel_items=hotel_items,
        available_points=user_points,
        transfer_options=transfer_options,
        all_cash_total=all_cash,
    )


def _edge_to_cost_item(edge: Dict[str, Any], item_id: str) -> Optional[TripCostItem]:
    """Convert a flight edge dict to a TripCostItem."""
    # Handle different edge formats
    if isinstance(edge, (list, tuple)) and len(edge) >= 3:
        # Edge is (origin, dest, flight_id) tuple
        origin, dest, flight_id = edge[0], edge[1], edge[2]
        return None  # Need more data
    
    if not isinstance(edge, dict):
        return None
    
    # Check if this is a connecting flight
    if _is_connecting_flight(edge):
        return create_connecting_flight_cost_item(item_id, edge)
    
    origin = edge.get("origin") or edge.get("departure") or ""
    dest = edge.get("destination") or edge.get("arrival") or ""
    
    if not origin or not dest:
        # Try tuple format
        if "edge" in edge:
            e = edge["edge"]
            if len(e) >= 2:
                origin, dest = e[0], e[1]
    
    cash_cost = edge.get("cash_cost") or edge.get("price") or edge.get("fare") or 0.0
    
    # Build points options
    points_options = []
    
    # Check for direct points option in edge
    points_cost = edge.get("points_cost") or edge.get("award_points") or edge.get("miles")
    if points_cost and points_cost > 0:
        surcharge = edge.get("points_surcharge") or edge.get("surcharge") or edge.get("tax") or 0.0
        program = edge.get("points_program") or edge.get("program_code") or edge.get("airline") or ""
        
        if program:
            points_options.append({
                "program_code": program.upper(),
                "points_required": int(points_cost),
                "surcharge": float(surcharge),
            })
    
    # Check for award_options list
    for opt in edge.get("award_options", []):
        if opt.get("points") or opt.get("miles"):
            points_options.append({
                "program_code": (opt.get("program") or opt.get("airline") or "").upper(),
                "points_required": int(opt.get("points") or opt.get("miles") or 0),
                "surcharge": float(opt.get("surcharge") or opt.get("tax") or 0),
            })
    
    if not origin or not dest:
        return None
    
    return create_flight_cost_item(
        item_id=item_id,
        origin=origin,
        destination=dest,
        cash_cost=float(cash_cost) if cash_cost else 0.0,
        points_options=points_options,
        date=edge.get("date") or edge.get("departure_date"),
        airline=edge.get("airline") or edge.get("carrier"),
        flight_number=edge.get("flight_number"),
    )


def _hotel_to_cost_item(hotel: Dict[str, Any], item_id: str) -> Optional[TripCostItem]:
    """Convert a hotel dict to a TripCostItem."""
    if not isinstance(hotel, dict):
        return None
    
    name = hotel.get("name") or hotel.get("hotel_name") or "Hotel"
    location = hotel.get("location") or hotel.get("destination") or hotel.get("city") or ""
    
    cash_cost = hotel.get("cash_cost") or hotel.get("cash") or hotel.get("price") or 0.0
    
    # Build points options
    points_options = []
    
    points_cost = hotel.get("points_cost") or hotel.get("points") or hotel.get("points_required")
    if points_cost and points_cost > 0:
        surcharge = hotel.get("surcharge") or hotel.get("tax") or 0.0
        program = hotel.get("program_code") or hotel.get("brand") or hotel.get("program") or ""
        
        if program:
            points_options.append({
                "program_code": program.upper(),
                "points_required": int(points_cost),
                "surcharge": float(surcharge),
            })
    
    # Check for points_options list
    for opt in hotel.get("points_options", []):
        if opt.get("points") or opt.get("points_required"):
            points_options.append({
                "program_code": (opt.get("program") or opt.get("brand") or "").upper(),
                "points_required": int(opt.get("points") or opt.get("points_required") or 0),
                "surcharge": float(opt.get("surcharge") or 0),
            })
    
    return create_hotel_cost_item(
        item_id=item_id,
        hotel_name=name,
        location=location,
        cash_cost=float(cash_cost) if cash_cost else 0.0,
        points_options=points_options,
        check_in=hotel.get("check_in") or hotel.get("checkin"),
        check_out=hotel.get("check_out") or hotel.get("checkout"),
        nights=hotel.get("nights"),
    )


# =============================================================================
# CONNECTING FLIGHT SUPPORT
# =============================================================================

def _is_connecting_flight(edge: Dict[str, Any]) -> bool:
    """Check if an edge represents a connecting flight (multiple legs)."""
    # Check for segments array (AwardTool format)
    segments = edge.get("segments") or edge.get("legs") or edge.get("products") or []
    if len(segments) > 1:
        return True
    
    # Check for connection info
    if edge.get("connection_airports") or edge.get("layovers"):
        return True
    
    # Check for stops count
    stops = edge.get("stops") or edge.get("num_stops") or 0
    return stops > 0


def _extract_connecting_flight_details(edge: Dict[str, Any]) -> Dict[str, Any]:
    """Extract details for a connecting flight."""
    segments = edge.get("segments") or edge.get("legs") or edge.get("products") or []
    
    if not segments:
        # Not a multi-segment edge, return basic info
        return {
            "is_connecting": False,
            "segments": [],
            "connection_airports": [],
            "total_duration": edge.get("time_cost") or edge.get("duration"),
            "layover_times": [],
        }
    
    connection_airports = []
    layover_times = []
    segment_details = []
    total_duration = 0
    
    for i, seg in enumerate(segments):
        origin = seg.get("origin") or seg.get("departure") or ""
        dest = seg.get("destination") or seg.get("arrival") or ""
        duration = seg.get("duration") or seg.get("travel_minutes") or 0
        layover = seg.get("layover_time") or seg.get("layover") or 0
        
        segment_details.append({
            "origin": origin,
            "destination": dest,
            "flight_number": seg.get("flight_number"),
            "carrier": seg.get("carrier") or seg.get("operating_carrier"),
            "duration": duration,
        })
        
        total_duration += duration
        
        # If not the last segment, this destination is a connection
        if i < len(segments) - 1:
            connection_airports.append(dest)
            layover_times.append(layover)
            total_duration += layover
    
    return {
        "is_connecting": len(segments) > 1,
        "segments": segment_details,
        "connection_airports": connection_airports,
        "total_duration": total_duration,
        "layover_times": layover_times,
        "num_stops": len(connection_airports),
    }


def create_connecting_flight_cost_item(
    item_id: str,
    edge: Dict[str, Any],
) -> Optional[TripCostItem]:
    """
    Create a TripCostItem for a connecting flight.
    
    Connecting flights are treated as a single item for optimization,
    but include details about all segments.
    """
    connection_details = _extract_connecting_flight_details(edge)
    
    origin = edge.get("origin") or ""
    destination = edge.get("destination") or ""
    
    # If we have segments, use first origin and last destination
    if connection_details["segments"]:
        origin = connection_details["segments"][0].get("origin", origin)
        destination = connection_details["segments"][-1].get("destination", destination)
    
    if not origin or not destination:
        return None
    
    # Build description
    if connection_details["is_connecting"]:
        via = ", ".join(connection_details["connection_airports"])
        desc = f"{origin} → {destination} (via {via})"
    else:
        desc = f"{origin} → {destination}"
    
    airline = edge.get("airline") or edge.get("carrier") or edge.get("operating_carrier")
    if airline:
        desc += f" ({airline})"
    
    # Extract pricing
    cash_cost = edge.get("cash_cost") or edge.get("price") or 0.0
    
    # Build points options
    points_options = []
    
    points_cost = edge.get("points_cost") or edge.get("award_points")
    if points_cost and points_cost > 0:
        surcharge = edge.get("points_surcharge") or edge.get("surcharge") or 0.0
        program = edge.get("points_program") or edge.get("program_code") or ""
        
        if program:
            points_options.append({
                "program_code": program.upper(),
                "points_required": int(points_cost),
                "surcharge": float(surcharge),
            })
    
    # Check for award_options list
    for opt in edge.get("award_options", []):
        if opt.get("points") or opt.get("miles"):
            points_options.append({
                "program_code": (opt.get("program") or opt.get("airline") or "").upper(),
                "points_required": int(opt.get("points") or opt.get("miles") or 0),
                "surcharge": float(opt.get("surcharge") or opt.get("tax") or 0),
            })
    
    item = create_flight_cost_item(
        item_id=item_id,
        origin=origin,
        destination=destination,
        cash_cost=float(cash_cost) if cash_cost else 0.0,
        points_options=points_options,
        date=edge.get("date") or edge.get("departure_date"),
        airline=airline,
        flight_number=edge.get("flight_number"),
    )
    
    # Add connection details as extra metadata
    if item:
        # Store connection info for UI display
        item.extra_data = {
            "is_connecting": connection_details["is_connecting"],
            "segments": connection_details["segments"],
            "connection_airports": connection_details["connection_airports"],
            "num_stops": connection_details.get("num_stops", 0),
            "total_duration": connection_details["total_duration"],
            "layover_times": connection_details["layover_times"],
        }
    
    return item


# =============================================================================
# HIGH-LEVEL OPTIMIZATION FUNCTIONS
# =============================================================================

async def optimize_trip_out_of_pocket(
    flight_edges: List[Dict[str, Any]],
    hotel_options: List[Dict[str, Any]],
    user_points: Dict[str, int],
    *,
    include_hotels: bool = True,
    max_cash_budget: Optional[float] = None,
    min_points_usage_pct: float = 0.0,
) -> MinOOPSolution:
    """
    Optimize entire trip for minimum out-of-pocket cost.
    
    Args:
        flight_edges: Flight options from ILP adapter or SERP/AwardTool
        hotel_options: Hotel options from hotels.py
        user_points: User's point balances
        include_hotels: Whether to include hotels in optimization
        max_cash_budget: Optional maximum cash to spend
        min_points_usage_pct: Force minimum point utilization (0-1)
        
    Returns:
        MinOOPSolution with optimal payment and transfer plan
    """
    # Aggregate costs
    hotel_opts = hotel_options if include_hotels else []
    cost_summary = await aggregate_trip_costs(flight_edges, hotel_opts, user_points)
    
    if not cost_summary.all_items:
        return MinOOPSolution(
            status="Optimal",
            all_cash_cost=0.0,
            total_out_of_pocket=0.0,
        )
    
    # Run optimization
    solution = minimize_out_of_pocket(
        items=cost_summary.all_items,
        available_points=user_points,
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
        max_cash_budget=max_cash_budget,
        min_points_usage_pct=min_points_usage_pct,
    )
    
    return solution


def optimize_trip_out_of_pocket_sync(
    flight_edges: List[Dict[str, Any]],
    hotel_options: List[Dict[str, Any]],
    user_points: Dict[str, int],
    **kwargs,
) -> MinOOPSolution:
    """Synchronous wrapper for optimize_trip_out_of_pocket."""
    return asyncio.run(optimize_trip_out_of_pocket(
        flight_edges, hotel_options, user_points, **kwargs
    ))


# =============================================================================
# INTEGRATION WITH EXISTING ITINERARY SERVICE
# =============================================================================

def build_oop_optimized_response(
    solution: MinOOPSolution,
    include_comparison: bool = True,
) -> Dict[str, Any]:
    """
    Build a response dict suitable for the frontend.
    
    Args:
        solution: The optimization solution
        include_comparison: Whether to include CPP comparison info
        
    Returns:
        Dict with all relevant info for frontend display
    """
    response = solution_to_dict(solution)
    
    # Add human-readable summary
    response["summary"] = {
        "total_out_of_pocket": f"${solution.total_out_of_pocket:,.2f}",
        "all_cash_would_cost": f"${solution.all_cash_cost:,.2f}",
        "you_save": f"${solution.savings:,.2f}",
        "savings_percentage": f"{solution.savings_percentage:.1f}%",
        "total_points_used": f"{solution.total_points_used:,}",
    }
    
    # Add transfer summary
    if solution.transfer_plan:
        response["transfer_summary"] = [
            {
                "action": f"Transfer {t.points_to_transfer:,} {t.from_program_name} → {t.to_program_name}",
                "ratio": t.transfer_ratio,
                "you_get": f"{t.resulting_points:,} {t.to_program_name} points",
                "time": t.transfer_time,
            }
            for t in solution.transfer_plan
        ]
    
    # Add booking order (transfers first, then bookings)
    booking_order = []
    step = 1
    
    # Transfers first
    for t in solution.transfer_plan:
        booking_order.append({
            "step": step,
            "type": "transfer",
            "action": f"Transfer {t.points_to_transfer:,} points from {t.from_program_name} to {t.to_program_name}",
            "url": t.portal_url,
        })
        step += 1
    
    # Then bookings
    for p in solution.payment_plan:
        if p.payment_type == "points":
            booking_order.append({
                "step": step,
                "type": "booking",
                "action": f"Book {p.description} using {p.points_used:,} {p.program_name} points (pay ${p.cash_paid:.2f} in fees)",
                "item_type": p.item_type,
            })
        else:
            booking_order.append({
                "step": step,
                "type": "booking",
                "action": f"Book {p.description} with cash (${p.cash_paid:.2f})",
                "item_type": p.item_type,
            })
        step += 1
    
    response["booking_order"] = booking_order
    
    return response


def enhance_itinerary_with_oop(
    existing_response: Dict[str, Any],
    solution: MinOOPSolution,
) -> Dict[str, Any]:
    """
    Enhance an existing itinerary response with OOP optimization data.
    
    This adds the transfer strategy alongside the existing CPP-based info.
    """
    oop_data = build_oop_optimized_response(solution)
    
    # Add under a new key
    existing_response["oop_optimization"] = oop_data
    existing_response["oop_out_of_pocket"] = solution.total_out_of_pocket
    existing_response["oop_savings"] = solution.savings
    
    # Update the out_of_pocket section if it exists
    if "out_of_pocket" in existing_response:
        existing_response["out_of_pocket"]["oop_optimized"] = {
            "total": solution.total_out_of_pocket,
            "savings": solution.savings,
            "transfer_plan": [
                {
                    "from": t.from_program_name,
                    "to": t.to_program_name,
                    "points": t.points_to_transfer,
                    "ratio": t.transfer_ratio,
                }
                for t in solution.transfer_plan
            ],
        }
    
    return existing_response
