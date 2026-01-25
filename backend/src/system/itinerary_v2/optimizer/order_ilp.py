"""
Route ordering optimizer for the v2 itinerary pipeline.

Uses a cheap ordering ILP (TSP/path-TSP with MTZ) to find the best
order to visit cities, given approximate pairwise costs.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Optional, Tuple

from ..schemas import RouteOrder

logger = logging.getLogger(__name__)


def compute_route_orders(
    start_airport: str,
    end_airport: str,
    must_visit: List[str],
    pairwise_costs: Dict[Tuple[str, str], float],
    max_orders: int = 3,
) -> List[RouteOrder]:
    """
    Compute top K route orders using TSP-style optimization.
    
    For small n (typical solo trips have < 5 cities), we can enumerate
    all permutations or use a simple ILP. For larger n, we use heuristics.
    
    Args:
        start_airport: Starting airport (fixed)
        end_airport: Ending airport (fixed)
        must_visit: Airports to visit (order flexible)
        pairwise_costs: Dict of (origin, dest) -> estimated cost
        max_orders: Maximum number of orders to return
        
    Returns:
        List of RouteOrder objects, sorted by estimated cost
    """
    from itertools import permutations
    
    if not must_visit:
        # Direct route: start -> end
        direct_cost = pairwise_costs.get((start_airport, end_airport), 0)
        return [RouteOrder(
            order_id="order_0",
            airports=[start_airport, end_airport],
            estimated_cost=direct_cost,
            score=1.0,
        )]
    
    # For small n, enumerate all permutations
    if len(must_visit) <= 6:
        return _enumerate_orders(
            start_airport, end_airport, must_visit, pairwise_costs, max_orders
        )
    else:
        # For larger n, use nearest neighbor heuristic + 2-opt
        return _heuristic_orders(
            start_airport, end_airport, must_visit, pairwise_costs, max_orders
        )


def _enumerate_orders(
    start: str,
    end: str,
    must_visit: List[str],
    costs: Dict[Tuple[str, str], float],
    max_orders: int,
) -> List[RouteOrder]:
    """Enumerate all permutations for small n."""
    from itertools import permutations
    
    candidates = []
    
    for perm in permutations(must_visit):
        # Build route: start -> perm[0] -> ... -> perm[-1] -> end
        route = [start] + list(perm) + [end]
        
        # Calculate total cost
        total_cost = 0.0
        for i in range(len(route) - 1):
            cost = costs.get((route[i], route[i + 1]), 10000)  # Default high cost
            total_cost += cost
        
        candidates.append((route, total_cost))
    
    # Sort by cost and take top max_orders
    candidates.sort(key=lambda x: x[1])
    
    orders = []
    for i, (route, cost) in enumerate(candidates[:max_orders]):
        order = RouteOrder(
            order_id=f"order_{i}",
            airports=route,
            estimated_cost=cost,
            score=1.0 / (1 + i * 0.1),  # Slightly prefer lower-cost orders
        )
        orders.append(order)
    
    return orders


def _heuristic_orders(
    start: str,
    end: str,
    must_visit: List[str],
    costs: Dict[Tuple[str, str], float],
    max_orders: int,
) -> List[RouteOrder]:
    """Use nearest neighbor + 2-opt for larger n."""
    candidates = []
    
    # Generate multiple starting points for diversity
    for seed_city in must_visit[:max_orders]:
        route = _nearest_neighbor(start, end, must_visit, costs, seed_city)
        route = _two_opt_improve(route, costs)
        total_cost = _route_cost(route, costs)
        candidates.append((route, total_cost))
    
    # Also try pure nearest neighbor from start
    route = _nearest_neighbor(start, end, must_visit, costs, None)
    route = _two_opt_improve(route, costs)
    candidates.append((route, _route_cost(route, costs)))
    
    # Sort and deduplicate
    seen = set()
    unique = []
    for route, cost in sorted(candidates, key=lambda x: x[1]):
        route_key = tuple(route)
        if route_key not in seen:
            seen.add(route_key)
            unique.append((route, cost))
    
    orders = []
    for i, (route, cost) in enumerate(unique[:max_orders]):
        order = RouteOrder(
            order_id=f"order_{i}",
            airports=route,
            estimated_cost=cost,
            score=1.0 / (1 + i * 0.1),
        )
        orders.append(order)
    
    return orders


def _nearest_neighbor(
    start: str,
    end: str,
    must_visit: List[str],
    costs: Dict[Tuple[str, str], float],
    seed: Optional[str] = None,
) -> List[str]:
    """Nearest neighbor heuristic for TSP."""
    unvisited = set(must_visit)
    route = [start]
    
    # If seed is specified, visit it first
    if seed and seed in unvisited:
        route.append(seed)
        unvisited.remove(seed)
    
    current = route[-1]
    while unvisited:
        # Find nearest unvisited city
        nearest = min(
            unvisited,
            key=lambda c: costs.get((current, c), float("inf")),
        )
        route.append(nearest)
        unvisited.remove(nearest)
        current = nearest
    
    route.append(end)
    return route


def _two_opt_improve(route: List[str], costs: Dict[Tuple[str, str], float]) -> List[str]:
    """2-opt local search to improve route."""
    improved = True
    best = list(route)
    
    while improved:
        improved = False
        best_cost = _route_cost(best, costs)
        
        # Try reversing each segment (excluding start and end)
        for i in range(1, len(best) - 2):
            for j in range(i + 1, len(best) - 1):
                new_route = best[:i] + best[i:j + 1][::-1] + best[j + 1:]
                new_cost = _route_cost(new_route, costs)
                
                if new_cost < best_cost:
                    best = new_route
                    best_cost = new_cost
                    improved = True
    
    return best


def _route_cost(route: List[str], costs: Dict[Tuple[str, str], float]) -> float:
    """Calculate total cost of a route."""
    total = 0.0
    for i in range(len(route) - 1):
        total += costs.get((route[i], route[i + 1]), 10000)
    return total


async def compute_pairwise_costs(
    airports: List[str],
    representative_date: date,
    run_id: str,
) -> Dict[Tuple[str, str], float]:
    """
    Compute approximate pairwise costs for route ordering.
    
    For v2 first cut, we use cached SERP results or simple distance-based
    estimates when SERP data isn't available.
    
    Args:
        airports: List of airports to compute costs for
        representative_date: Date to use for SERP queries
        run_id: Correlation ID for logging
        
    Returns:
        Dict mapping (origin, dest) to estimated cost
    """
    from ..providers.serp_provider import fetch_serp_options
    
    costs = {}
    
    # For each pair, try to get SERP minimum or use estimate
    pairs = [(o, d) for o in airports for d in airports if o != d]
    
    for origin, dest in pairs:
        try:
            options = await fetch_serp_options(
                origin, dest, representative_date, run_id,
                travel_class="economy", pax=1,
            )
            
            if options:
                min_cost = min(
                    o.cash_usd for o in options
                    if o.cash_usd is not None
                )
                costs[(origin, dest)] = min_cost
            else:
                # Use distance-based estimate
                costs[(origin, dest)] = _estimate_cost(origin, dest)
                
        except Exception as e:
            logger.debug(f"Failed to get cost for {origin}->{dest}: {e}")
            costs[(origin, dest)] = _estimate_cost(origin, dest)
    
    return costs


def _estimate_cost(origin: str, dest: str) -> float:
    """
    Estimate flight cost based on simple heuristics.
    
    This is a rough estimate when SERP data isn't available.
    """
    # Simple estimate: $0.10 per mile, assume 500-5000 miles
    # This is intentionally rough; real SERP data is preferred
    
    # Known major city pairs with rough estimates
    estimates = {
        ("JFK", "LHR"): 500,
        ("JFK", "CDG"): 550,
        ("JFK", "FCO"): 600,
        ("LAX", "NRT"): 700,
        ("SFO", "HKG"): 750,
    }
    
    # Check both directions
    if (origin, dest) in estimates:
        return estimates[(origin, dest)]
    if (dest, origin) in estimates:
        return estimates[(dest, origin)]
    
    # Default estimate based on domestic vs international
    us_airports = {"JFK", "LAX", "SFO", "ORD", "ATL", "DFW", "MIA", "SEA", "BOS", "DEN"}
    
    if origin in us_airports and dest in us_airports:
        return 200  # Domestic US
    elif origin in us_airports or dest in us_airports:
        return 600  # International from/to US
    else:
        return 400  # International other
