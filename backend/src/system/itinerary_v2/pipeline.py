"""
v2 Itinerary Generation Pipeline

Orchestrates the full v2 itinerary generation flow:
1. Load and normalize inputs (trip, destinations, points)
2. Order cities optimally
3. Schedule legs with dates
4. Fetch options for each leg (SERP + AwardTool)
5. Optimize payment/transfers (ILP)
6. Render and save itinerary items

Main entrypoint: generate_itinerary_v2(trip_id)
"""

from __future__ import annotations

import logging
import time
import uuid
from datetime import date, timedelta
from typing import Dict, List, Any, Optional

from .schemas import (
    InputBundle, TripConstraints, RouteOrder, ScheduledLeg,
    ScheduledRoute, V2Result,
)
from .inputs import load_input_bundle
from .providers.serp_provider import fetch_serp_options_batch
from .providers.award_provider import fetch_award_options_batch
from .providers.http_logging import log_run_end, log_error, log_leg_fetch
from .edges import build_leg_options_map, summarize_leg_options
from .optimizer.order_ilp import compute_route_orders, compute_pairwise_costs
from .optimizer.payment_ilp import run_optimization_with_relaxation
from .render import render_itinerary_items, save_items_to_repo

logger = logging.getLogger(__name__)


async def generate_itinerary_v2(trip_id: str) -> Dict[str, Any]:
    """
    Generate an optimized itinerary using the v2 pipeline.
    
    This is the main entrypoint for v2 itinerary generation.
    
    Args:
        trip_id: The trip ID to generate itinerary for
        
    Returns:
        Dict with status, solution, and items (same shape as v1)
        
    Raises:
        ValueError: If trip data is invalid or generation fails
    """
    run_id = str(uuid.uuid4())[:8]
    start_time = time.time()
    
    try:
        # 1. Load and normalize inputs
        bundle = await load_input_bundle(trip_id, run_id)
        
        # 2. Order cities optimally
        routes = await _order_cities(bundle, run_id)
        if not routes:
            raise ValueError("Could not compute route orders")
        
        best_route = routes[0]
        
        # 3. Schedule legs with dates
        scheduled = _schedule_legs(bundle.constraints, best_route)
        
        # 4. Fetch options for each leg
        leg_options = await _fetch_leg_options(scheduled.legs, bundle, run_id)
        
        # 5. Optimize payment/transfers
        solution, relaxed_msg = await run_optimization_with_relaxation(
            leg_options_map=leg_options,
            travelers=bundle.travelers,
            start_airport=bundle.constraints.start_airport,
            end_airport=bundle.constraints.end_airport,
            points_by_traveler=bundle.points_by_traveler,
            max_budget_usd=bundle.constraints.max_budget_usd,
            run_id=run_id,
            must_visit_cities=list(bundle.constraints.must_visit_airports),
            benefit_airlines=None,  # TODO: Load from user profiles
        )
        
        # 6. Render and save
        items = render_itinerary_items(
            trip_id=trip_id,
            solution=solution,
            constraints=bundle.constraints,
            run_id=run_id,
            max_budget=bundle.constraints.max_budget_usd,
            relaxed_message=relaxed_msg,
        )
        
        save_items_to_repo(items)
        
        elapsed_ms = int((time.time() - start_time) * 1000)
        
        log_run_end(
            run_id=run_id,
            trip_id=trip_id,
            status=solution.status,
            totals=solution.totals,
            item_count=len(items),
            elapsed_ms=elapsed_ms,
        )
        
        result = {
            "status": solution.status,
            "solution": {
                "path": solution.paths,
                "pay_mode": {t: [_payment_to_dict(p) for p in ps] for t, ps in solution.payments.items()},
                "totals": solution.totals,
            },
            "items": items,
        }
        
        if relaxed_msg:
            result["relaxed_constraints"] = True
            result["relaxed_message"] = relaxed_msg
        
        return result
        
    except Exception as e:
        log_error(run_id, trip_id, e, {"phase": "pipeline"})
        raise


async def _order_cities(bundle: InputBundle, run_id: str) -> List[RouteOrder]:
    """Compute optimal city ordering."""
    constraints = bundle.constraints
    
    # Collect all airports
    airports = [constraints.start_airport]
    airports.extend(constraints.must_visit_airports)
    if constraints.end_airport not in airports:
        airports.append(constraints.end_airport)
    
    # For single destination, return direct route
    if len(airports) <= 2:
        return [RouteOrder(
            order_id="order_0",
            airports=airports,
            estimated_cost=0,
            score=1.0,
        )]
    
    # Get representative date for cost estimation
    rep_date = constraints.start_date or date.today() + timedelta(days=30)
    
    # Compute pairwise costs
    pairwise_costs = await compute_pairwise_costs(airports, rep_date, run_id)
    
    # Compute route orders
    routes = compute_route_orders(
        start_airport=constraints.start_airport,
        end_airport=constraints.end_airport,
        must_visit=list(constraints.must_visit_airports),
        pairwise_costs=pairwise_costs,
        max_orders=3,
    )
    
    return routes


def _schedule_legs(
    constraints: TripConstraints,
    route: RouteOrder,
) -> ScheduledRoute:
    """Assign dates to each leg in the route."""
    airports = route.airports
    
    # Determine dates
    if constraints.start_date and constraints.end_date:
        total_days = (constraints.end_date - constraints.start_date).days
    elif constraints.duration_days:
        total_days = constraints.duration_days
    else:
        total_days = 7  # Default
    
    start_date = constraints.start_date or (date.today() + timedelta(days=30))
    
    # Allocate days per city (equal split for now)
    num_stays = max(1, len(airports) - 1)  # -1 for origin
    days_per_stay = max(1, total_days // num_stays)
    
    # Build legs with dates
    legs = []
    current_date = start_date
    city_stays = {}
    
    for i in range(len(airports) - 1):
        origin = airports[i]
        dest = airports[i + 1]
        
        legs.append(ScheduledLeg(origin=origin, destination=dest, date=current_date))
        
        # Record stay duration for destination
        if i < len(airports) - 2:  # Not the final leg
            city_stays[dest] = days_per_stay
            current_date = current_date + timedelta(days=days_per_stay)
        else:
            city_stays[dest] = 0  # Final destination (return home)
    
    return ScheduledRoute(order=route, legs=legs, city_stays=city_stays)


async def _fetch_leg_options(
    legs: List[ScheduledLeg],
    bundle: InputBundle,
    run_id: str,
) -> Dict:
    """Fetch SERP and AwardTool options for all legs."""
    from .edges import build_leg_options_map
    
    # Build leg tuples for batch fetch
    leg_tuples = [(leg.origin, leg.destination, leg.date) for leg in legs]
    
    # Fetch SERP and AwardTool options in parallel
    pax = len(bundle.travelers)
    
    import asyncio
    serp_task = fetch_serp_options_batch(
        leg_tuples, run_id, travel_class="economy", pax=pax
    )
    award_task = fetch_award_options_batch(
        leg_tuples, run_id, pax=pax
    )
    
    serp_results, award_results = await asyncio.gather(serp_task, award_task)
    
    # Log per-leg fetch results
    for leg in legs:
        key = (leg.origin, leg.destination, leg.date)
        serp_opts = serp_results.get(key, [])
        award_opts = award_results.get(key, [])
        
        min_cash = min((o.cash_usd for o in serp_opts if o.cash_usd), default=None)
        min_miles = min((o.award_miles for o in award_opts if o.award_miles), default=None)
        
        log_leg_fetch(
            run_id=run_id,
            leg=f"{leg.origin}->{leg.destination}",
            serp_count=len(serp_opts),
            serp_min_cash=min_cash,
            award_count=len(award_opts),
            award_min_miles=min_miles,
            fallback_used=len(serp_opts) == 0 and len(award_opts) == 0,
        )
    
    # Build leg options map
    return build_leg_options_map(legs, serp_results, award_results)


def _payment_to_dict(payment) -> Dict[str, Any]:
    """Convert SolvedPayment to dict for response."""
    rec = {
        "edge": list(payment.edge),
        "type": payment.payment_type,
        "payer": payment.payer,
        "mode": payment.mode,
    }
    
    if payment.payment_type == "cash":
        rec["fare"] = payment.fare
    else:
        if payment.via_source and payment.via_airline:
            rec["via"] = {"source": payment.via_source, "airline": payment.via_airline}
        elif payment.via_native:
            rec["via"] = {"native": payment.via_native}
        
        rec["miles"] = payment.miles
        rec["surcharge"] = payment.surcharge
        if payment.points_value:
            rec["points_value"] = payment.points_value
        if payment.cents_per_point:
            rec["cents_per_point"] = payment.cents_per_point
    
    return rec
