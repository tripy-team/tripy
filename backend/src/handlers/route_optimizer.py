"""
Route Optimization Handler

Provides advanced routing strategies for minimizing out-of-pocket costs:

1. Positioning Flight Analysis: Check if flying to a hub first saves money
2. Award Sweet Spot Routing: Use known good award routes
3. Partner Award Routing: Book via partners with lower surcharges
"""

import asyncio
import logging
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass

from src.utils.oop_optimizer import (
    find_sweet_spots,
    POSITIONING_HUBS,
    get_airport_region,
    AwardSweetSpot,
)
from src.utils.award_programs import (
    get_partner_programs,
    get_partner_surcharge,
    HIGH_SURCHARGE_PROGRAMS,
)

logger = logging.getLogger(__name__)


@dataclass
class PositioningOption:
    """Represents a positioning flight option."""
    hub: str
    positioning_cost: float  # Cost to get to hub
    hub_to_dest_oop: float  # OOP from hub to destination
    total_oop: float
    savings: float  # Compared to direct
    savings_percentage: float
    recommended: bool
    notes: str = ""


@dataclass
class RouteOption:
    """Represents a complete route option."""
    route_type: str  # "direct", "positioned", "sweet_spot", "partner"
    legs: List[Dict[str, Any]]
    total_oop: float
    total_points: int
    total_cash_saved: float
    cpp: float
    notes: str = ""


async def analyze_positioning_flights(
    home_airport: str,
    destination: str,
    date: str,
    home_oop: float,
    user_points: Dict[str, int],
    min_savings_pct: float = 0.20,
) -> List[PositioningOption]:
    """
    Analyze if positioning to a major hub saves money.
    
    Sometimes flying to a different airport first (positioning) and then
    taking an international flight provides better award availability
    and lower overall OOP.
    
    Args:
        home_airport: User's home airport
        destination: Final destination
        date: Travel date
        home_oop: OOP for direct flight from home
        user_points: User's points balances
        min_savings_pct: Minimum savings percentage to recommend
    
    Returns:
        List of positioning options sorted by savings
    """
    from .flights import get_flights_award_first_with_points_async
    
    options = []
    
    for hub in POSITIONING_HUBS:
        if hub == home_airport:
            continue
        
        # Skip hubs that are farther from destination than home
        home_region = get_airport_region(home_airport)
        hub_region = get_airport_region(hub)
        dest_region = get_airport_region(destination)
        
        # Simple heuristic: skip if home and hub are same coast for transatlantic
        if home_region == hub_region and dest_region not in [home_region, hub_region]:
            # Allow if hub is a major international gateway
            if hub not in ["JFK", "EWR", "LAX", "SFO", "MIA", "ORD", "IAD"]:
                continue
        
        try:
            # Get positioning cost (home -> hub)
            filters_position = {
                "outbound_date": date,
                "travel_class": "economy",
                "pax": 1,
            }
            position_edges = await get_flights_award_first_with_points_async(
                home_airport, hub, user_points, filters_position
            )
            
            if not position_edges:
                continue
            
            # Find cheapest positioning flight
            position_cost = float('inf')
            for key, data in position_edges.items():
                cost = data.get("cash_cost") or data.get("points_surcharge") or float('inf')
                if cost < position_cost:
                    position_cost = cost
            
            if position_cost >= float('inf'):
                continue
            
            # Get hub -> destination cost
            hub_edges = await get_flights_award_first_with_points_async(
                hub, destination, user_points, filters_position
            )
            
            if not hub_edges:
                continue
            
            # Find best OOP from hub
            hub_oop = float('inf')
            for key, data in hub_edges.items():
                # Prefer award if surcharge is low
                surcharge = data.get("points_surcharge")
                cash = data.get("cash_cost")
                
                if surcharge is not None and surcharge < hub_oop:
                    hub_oop = surcharge
                elif cash is not None and cash < hub_oop:
                    hub_oop = cash
            
            if hub_oop >= float('inf'):
                continue
            
            total_oop = position_cost + hub_oop
            savings = home_oop - total_oop
            savings_pct = savings / home_oop if home_oop > 0 else 0
            
            recommended = savings_pct >= min_savings_pct and savings > 50
            
            notes = ""
            if recommended:
                notes = f"Position to {hub} for ${savings:.0f} savings ({savings_pct*100:.0f}%)"
            
            options.append(PositioningOption(
                hub=hub,
                positioning_cost=position_cost,
                hub_to_dest_oop=hub_oop,
                total_oop=total_oop,
                savings=savings,
                savings_percentage=savings_pct * 100,
                recommended=recommended,
                notes=notes,
            ))
            
        except Exception as e:
            logger.debug(f"Error analyzing positioning to {hub}: {e}")
            continue
    
    # Sort by savings (highest first)
    return sorted(options, key=lambda o: -o.savings)


def find_sweet_spot_routes(
    origin: str,
    destination: str,
    cabin: str = "economy",
    user_banks: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Find award sweet spots for a route.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        cabin: Cabin class (economy, business, first)
        user_banks: List of bank programs user has points with
    
    Returns:
        List of sweet spot recommendations
    """
    from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH
    
    sweet_spots = find_sweet_spots(origin, destination, cabin)
    
    recommendations = []
    for spot in sweet_spots:
        # Check if user can transfer to this program
        can_transfer = False
        transfer_from = None
        
        if user_banks:
            for bank in user_banks:
                if DEFAULT_TRANSFER_GRAPH.get(bank.lower(), {}).get(spot.program):
                    can_transfer = True
                    transfer_from = bank
                    break
        
        rec = {
            "program": spot.program,
            "typical_points": spot.typical_points,
            "cabin": spot.cabin,
            "via_hub": spot.via_hub,
            "notes": spot.notes,
            "can_transfer": can_transfer,
            "transfer_from": transfer_from,
            "origin_region": spot.origin_region,
            "destination_region": spot.destination_region,
        }
        
        if spot.via_hub:
            rec["routing"] = f"{origin} → {spot.via_hub} → {destination}"
        else:
            rec["routing"] = f"{origin} → {destination}"
        
        recommendations.append(rec)
    
    return recommendations


def find_partner_award_options(
    operating_carrier: str,
    default_surcharge: float,
    user_programs: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Find partner programs that can book flights on an operating carrier
    with potentially lower surcharges.
    
    Args:
        operating_carrier: The airline operating the flight
        default_surcharge: The surcharge when booking directly
        user_programs: Programs the user has access to
    
    Returns:
        List of partner booking options sorted by surcharge
    """
    partners = get_partner_programs(operating_carrier)
    options = []
    
    for partner in partners:
        partner_surcharge = get_partner_surcharge(
            operating_carrier, partner, default_surcharge
        )
        
        savings = default_surcharge - partner_surcharge
        
        # Check if user has access to this program
        user_has_access = user_programs is None or partner in user_programs
        
        options.append({
            "booking_program": partner,
            "operating_carrier": operating_carrier,
            "surcharge": partner_surcharge,
            "savings_vs_direct": savings,
            "is_direct": partner == operating_carrier,
            "user_has_access": user_has_access,
            "high_surcharge_warning": operating_carrier in HIGH_SURCHARGE_PROGRAMS and partner == operating_carrier,
        })
    
    # Sort by surcharge (lowest first)
    return sorted(options, key=lambda o: (not o["user_has_access"], o["surcharge"]))


async def get_comprehensive_route_options(
    origin: str,
    destination: str,
    date: str,
    user_points: Dict[str, int],
    user_banks: List[str],
    include_positioning: bool = True,
    include_sweet_spots: bool = True,
) -> Dict[str, Any]:
    """
    Get comprehensive route options including direct, positioned, and sweet spots.
    
    This is the main entry point for route optimization.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        date: Travel date
        user_points: User's points balances
        user_banks: Bank programs user has
        include_positioning: Whether to analyze positioning flights
        include_sweet_spots: Whether to include sweet spot recommendations
    
    Returns:
        Comprehensive route options
    """
    from .flights import get_flights_award_first_with_points_async
    
    results = {
        "origin": origin,
        "destination": destination,
        "date": date,
        "direct": None,
        "positioning_options": [],
        "sweet_spots": [],
        "partner_options": [],
        "recommendation": None,
    }
    
    # Get direct flight options
    filters = {
        "outbound_date": date,
        "travel_class": "economy",
        "pax": 1,
    }
    
    try:
        direct_edges = await get_flights_award_first_with_points_async(
            origin, destination, user_points, filters
        )
        
        if direct_edges:
            # Find best direct option
            best_direct_oop = float('inf')
            best_direct_data = None
            
            for key, data in direct_edges.items():
                surcharge = data.get("points_surcharge")
                cash = data.get("cash_cost")
                
                if surcharge is not None and surcharge < best_direct_oop:
                    best_direct_oop = surcharge
                    best_direct_data = {**data, "payment": "award", "oop": surcharge}
                elif cash is not None and cash < best_direct_oop:
                    best_direct_oop = cash
                    best_direct_data = {**data, "payment": "cash", "oop": cash}
            
            if best_direct_data:
                results["direct"] = {
                    "oop": best_direct_oop,
                    "data": best_direct_data,
                }
                
                # Find partner options if high surcharge
                if best_direct_data.get("operating_airline"):
                    results["partner_options"] = find_partner_award_options(
                        best_direct_data["operating_airline"],
                        best_direct_data.get("points_surcharge", 0) or 0,
                        list(user_points.keys()),
                    )
    except Exception as e:
        logger.warning(f"Error getting direct flights: {e}")
    
    # Analyze positioning options
    if include_positioning and results["direct"]:
        try:
            results["positioning_options"] = await analyze_positioning_flights(
                origin, destination, date,
                results["direct"]["oop"],
                user_points,
            )
        except Exception as e:
            logger.warning(f"Error analyzing positioning: {e}")
    
    # Get sweet spot recommendations
    if include_sweet_spots:
        results["sweet_spots"] = find_sweet_spot_routes(
            origin, destination, "economy", user_banks
        )
    
    # Generate recommendation
    recommendation = None
    
    # Check if positioning saves money
    positioned = [p for p in results["positioning_options"] if p.recommended]
    if positioned:
        best_pos = positioned[0]
        recommendation = {
            "type": "positioning",
            "message": f"Consider flying to {best_pos.hub} first to save ${best_pos.savings:.0f}",
            "savings": best_pos.savings,
            "hub": best_pos.hub,
        }
    
    # Check for sweet spots the user can use
    usable_sweet_spots = [s for s in results["sweet_spots"] if s["can_transfer"]]
    if usable_sweet_spots and not recommendation:
        best_ss = usable_sweet_spots[0]
        recommendation = {
            "type": "sweet_spot",
            "message": f"Consider using {best_ss['program']} for ~{best_ss['typical_points']:,} points",
            "program": best_ss["program"],
            "typical_points": best_ss["typical_points"],
        }
    
    # Check for partner options with lower surcharges
    better_partners = [
        p for p in results["partner_options"]
        if not p["is_direct"] and p["savings_vs_direct"] > 50 and p["user_has_access"]
    ]
    if better_partners and not recommendation:
        best_partner = better_partners[0]
        recommendation = {
            "type": "partner",
            "message": f"Book via {best_partner['booking_program']} to save ${best_partner['savings_vs_direct']:.0f} on surcharges",
            "booking_program": best_partner["booking_program"],
            "savings": best_partner["savings_vs_direct"],
        }
    
    results["recommendation"] = recommendation
    
    return results


# =============================================================================
# MIXED CABIN OPTIMIZATION
# =============================================================================

async def compare_cabin_options(
    origin: str,
    destination: str,
    date: str,
    user_points: Dict[str, int],
) -> Dict[str, Any]:
    """
    Compare OOP and value across cabin classes.
    
    Sometimes business class awards provide much better CPP value
    than economy, making them worth the extra points.
    
    Returns comparison of economy, premium economy, business, and first class options.
    """
    from .flights import get_flights_award_first_with_points_async
    
    cabins = ["economy", "premium_economy", "business", "first"]
    options = []
    
    for cabin in cabins:
        try:
            filters = {
                "outbound_date": date,
                "travel_class": cabin,
                "pax": 1,
            }
            
            edges = await get_flights_award_first_with_points_async(
                origin, destination, user_points, filters
            )
            
            if not edges:
                continue
            
            # Find best award and cash options
            best_award = None
            best_cash = None
            
            for key, data in edges.items():
                points = data.get("points_cost")
                surcharge = data.get("points_surcharge")
                cash = data.get("cash_cost")
                
                if points and surcharge is not None:
                    if best_award is None or surcharge < best_award.get("surcharge", float('inf')):
                        best_award = {
                            "points": points,
                            "surcharge": surcharge,
                        }
                
                if cash is not None:
                    if best_cash is None or cash < best_cash:
                        best_cash = cash
            
            if best_award and best_cash:
                savings = best_cash - best_award["surcharge"]
                cpp = (savings * 100 / best_award["points"]) if best_award["points"] > 0 else 0
                
                options.append({
                    "cabin": cabin,
                    "award_points": best_award["points"],
                    "award_surcharge": best_award["surcharge"],
                    "cash_price": best_cash,
                    "savings": savings,
                    "cpp": round(cpp, 2),
                    "oop": best_award["surcharge"],
                })
            elif best_cash:
                options.append({
                    "cabin": cabin,
                    "award_points": None,
                    "award_surcharge": None,
                    "cash_price": best_cash,
                    "savings": 0,
                    "cpp": 0,
                    "oop": best_cash,
                })
        except Exception as e:
            logger.debug(f"Error getting {cabin} options: {e}")
    
    # Sort by savings (highest first) to show best value
    options_by_savings = sorted(options, key=lambda o: -o["savings"])
    
    # Sort by OOP (lowest first) to show cheapest
    options_by_oop = sorted(options, key=lambda o: o["oop"])
    
    # Determine recommendation
    recommendation = None
    if len(options_by_savings) >= 2:
        best_value = options_by_savings[0]
        lowest_oop = options_by_oop[0]
        
        if best_value["cabin"] != lowest_oop["cabin"]:
            if best_value["savings"] > lowest_oop["savings"] + 500:
                recommendation = {
                    "type": "upgrade_value",
                    "message": f"{best_value['cabin'].title()} provides ${best_value['savings'] - lowest_oop['savings']:.0f} more savings at {best_value['cpp']} cpp",
                    "recommended_cabin": best_value["cabin"],
                }
            else:
                recommendation = {
                    "type": "lowest_oop",
                    "message": f"{lowest_oop['cabin'].title()} has the lowest out-of-pocket cost",
                    "recommended_cabin": lowest_oop["cabin"],
                }
    
    return {
        "options": options,
        "by_savings": options_by_savings,
        "by_oop": options_by_oop,
        "recommendation": recommendation,
    }


# =============================================================================
# GROUP PAYMENT OPTIMIZATION
# =============================================================================

def optimize_group_payment(
    travelers: List[str],
    points_balances: Dict[str, Dict[str, int]],
    award_price: int,
    award_surcharge: float,
    cash_price: float,
    available_award_seats: int,
    airline_program: str,
) -> Dict[str, Any]:
    """
    Optimize payment split for a group when award seats are limited.
    
    Assigns award seats to travelers who can afford them and have the most points.
    
    Args:
        travelers: List of traveler IDs
        points_balances: {traveler_id: {program: points}}
        award_price: Points cost per seat
        award_surcharge: Taxes/fees per award seat
        cash_price: Cash price per seat
        available_award_seats: Number of available award seats
        airline_program: Airline program code for the award
    
    Returns:
        Optimization result with assignments and totals
    """
    # Calculate who can afford the award
    can_afford = []
    for traveler in travelers:
        balances = points_balances.get(traveler, {})
        # Check if they have enough in any transferable program
        total_usable = sum(
            bal for prog, bal in balances.items()
        )
        if total_usable >= award_price:
            can_afford.append((traveler, total_usable))
    
    # Sort by points balance (highest first)
    can_afford.sort(key=lambda x: -x[1])
    
    # Assign award seats
    assignments = []
    award_seats_used = 0
    total_oop = 0.0
    total_points = 0
    
    for traveler in travelers:
        # Check if this traveler should get an award seat
        should_award = False
        for t, bal in can_afford:
            if t == traveler and award_seats_used < available_award_seats:
                should_award = True
                break
        
        if should_award:
            assignments.append({
                "traveler_id": traveler,
                "payment_type": "award",
                "points_used": award_price,
                "oop": award_surcharge,
            })
            award_seats_used += 1
            total_oop += award_surcharge
            total_points += award_price
        else:
            assignments.append({
                "traveler_id": traveler,
                "payment_type": "cash",
                "points_used": 0,
                "oop": cash_price,
            })
            total_oop += cash_price
    
    all_cash_oop = cash_price * len(travelers)
    savings = all_cash_oop - total_oop
    
    return {
        "assignments": assignments,
        "total_oop": total_oop,
        "total_points_used": total_points,
        "award_seats_used": award_seats_used,
        "cash_seats_used": len(travelers) - award_seats_used,
        "comparison_all_cash": all_cash_oop,
        "savings": savings,
        "savings_percentage": (savings / all_cash_oop * 100) if all_cash_oop > 0 else 0,
    }
