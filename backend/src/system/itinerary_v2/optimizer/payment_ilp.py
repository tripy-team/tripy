"""
Payment optimizer for the v2 itinerary pipeline.

Adapts the v1 points_maximizer ILP to operate on v2 EdgeOptions.
Selects exactly one option per scheduled leg and decides cash vs award
payment with transfers.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Dict, List, Optional, Any, Tuple

from ..schemas import (
    EdgeOption, ScheduledLeg, LegOptions, SolvedPayment, SolvedItinerary,
)
from ..edges import convert_to_v1_edges_dict
from ..providers.http_logging import log_ilp_start, log_ilp_end

logger = logging.getLogger(__name__)


def run_payment_optimization(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
    travelers: List[str],
    start_airport: str,
    end_airport: str,
    points_by_traveler: Dict[str, Dict[str, int]],
    max_budget_usd: Optional[int],
    run_id: str,
    must_visit_cities: Optional[List[str]] = None,
    benefit_airlines: Optional[Dict[str, set]] = None,
) -> SolvedItinerary:
    """
    Run the payment optimization ILP.
    
    Uses the v1 ILP adapter + points_maximizer by converting v2 EdgeOptions
    to v1-style edges_dict format.
    
    Args:
        leg_options_map: Map of scheduled leg -> options
        travelers: List of traveler IDs
        start_airport: Starting airport
        end_airport: Ending airport
        points_by_traveler: Points balances per traveler per program
        max_budget_usd: Maximum budget per traveler
        run_id: Correlation ID for logging
        must_visit_cities: Cities that must be visited
        benefit_airlines: Payer -> airlines with card benefits
        
    Returns:
        SolvedItinerary with payment decisions
    """
    from src.handlers.ilp_adapter import run_ilp_from_edges
    from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH

    try:
        from src.services.transfer_bonus_scraper import get_ilp_transfer_bonuses
        _transfer_bonuses = get_ilp_transfer_bonuses()
    except Exception:
        _transfer_bonuses = {}

    try:
        from src.handlers.points_maximizer import plan_maximize_points_value
    except ImportError:
        logger.warning("pulp/points_maximizer not available, returning cash-only solution")
        return _cash_only_solution(leg_options_map, travelers, start_airport, end_airport)
    
    # Convert to v1 edges dict
    edges_dict = convert_to_v1_edges_dict(leg_options_map)
    
    if not edges_dict:
        logger.warning("No edges available for ILP optimization")
        return SolvedItinerary(
            status="Infeasible",
            paths={t: [] for t in travelers},
            payments={t: [] for t in travelers},
            totals={"cash": 0, "airline_points": 0, "time": 0, "points_value": 0},
            transfers={t: {} for t in travelers},
            native_used={t: {} for t in travelers},
        )
    
    # Count options and programs for logging
    total_options = len(edges_dict)
    all_programs = set()
    for pt in points_by_traveler.values():
        all_programs.update(pt.keys())
    
    log_ilp_start(
        run_id=run_id,
        leg_count=len(leg_options_map),
        option_count=total_options,
        traveler_count=len(travelers),
        points_programs=len(all_programs),
    )
    
    # Build start/end city mappings (all travelers same for now)
    start_city_by_trav = {t: start_airport for t in travelers}
    end_city_by_trav = {t: end_airport for t in travelers}
    
    # Determine budget per traveler
    default_cash_budget = (max_budget_usd // len(travelers)) if (max_budget_usd and len(travelers)) else 1e9
    
    try:
        solution = run_ilp_from_edges(
            edges_dict,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            points_by_traveler,
            plan_maximize_points_value,
            meetup_cities=[],
            require_meetup_in_graph=False,
            must_visit_cities=must_visit_cities or [],
            transfer_graph=DEFAULT_TRANSFER_GRAPH,
            transfer_bonuses=_transfer_bonuses,
            bank_block_size=1000,
            allow_all_payers=True,
            default_cash_if_missing=1e7,
            default_time_if_missing=1e6,
            default_cash_budget=default_cash_budget,
            benefit_airlines=benefit_airlines or {},
        )
    except Exception as e:
        logger.error(f"ILP optimization failed: {e}", exc_info=True)
        log_ilp_end(
            run_id=run_id,
            status="Error",
            objective_value=None,
            totals={"error": str(e)},
            chosen_options=[],
        )
        return _cash_only_solution(leg_options_map, travelers, start_airport, end_airport)
    
    status = solution.get("status", "Unknown")
    totals = solution.get("totals", {})
    
    # Extract chosen options for logging
    chosen_options = []
    for t, edges in solution.get("edges", {}).items():
        for edge in edges:
            if len(edge) >= 3:
                chosen_options.append(edge[2])  # option_id
    
    log_ilp_end(
        run_id=run_id,
        status=status,
        objective_value=totals.get("points_value"),
        totals={
            "cash": totals.get("cash", 0),
            "airline_points": totals.get("airline_points", 0),
            "time": totals.get("time", 0),
            "points_value": totals.get("points_value", 0),
        },
        chosen_options=chosen_options,
    )
    
    return _convert_solution(solution, travelers)


def _convert_solution(solution: Dict[str, Any], travelers: List[str]) -> SolvedItinerary:
    """Convert v1 ILP solution to SolvedItinerary."""
    status = solution.get("status", "Unknown")
    paths = solution.get("path", {t: [] for t in travelers})
    
    # Convert pay_mode to SolvedPayment list
    payments = {}
    for t, pay_list in solution.get("pay_mode", {}).items():
        payments[t] = []
        for pay in pay_list:
            edge = pay.get("edge", [])
            payment_type = pay.get("type", "cash")
            
            via = pay.get("via", {})
            
            sp = SolvedPayment(
                edge=tuple(edge) if edge else ("", "", ""),
                payment_type=payment_type,
                payer=pay.get("payer", t),
                fare=pay.get("fare") if payment_type == "cash" else None,
                via_source=via.get("source") if isinstance(via, dict) else None,
                via_airline=via.get("airline") if isinstance(via, dict) else None,
                via_native=via.get("native") if isinstance(via, dict) else None,
                miles=pay.get("miles"),
                surcharge=pay.get("surcharge"),
                points_value=pay.get("points_value"),
                cents_per_point=pay.get("cents_per_point"),
                mode=pay.get("mode", "flight"),
            )
            payments[t].append(sp)
    
    totals = solution.get("totals", {})
    transfers = totals.get("transfers", {t: {} for t in travelers})
    native_used = totals.get("native_used", {t: {} for t in travelers})
    
    return SolvedItinerary(
        status=status,
        paths=paths,
        payments=payments,
        totals=totals,
        transfers=transfers,
        native_used=native_used,
    )


def _cash_only_solution(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
    travelers: List[str],
    start_airport: str,
    end_airport: str,
) -> SolvedItinerary:
    """
    Create a cash-only fallback solution when ILP is not available.
    
    Picks the cheapest cash option for each leg.
    """
    # Build path from legs
    legs = sorted(leg_options_map.keys(), key=lambda l: l.date)
    path = [start_airport]
    
    payments = {t: [] for t in travelers}
    total_cash = 0.0
    total_time = 0.0
    
    for leg in legs:
        options = leg_options_map[leg].options
        
        # Find cheapest cash option
        cash_options = [o for o in options if o.cash_usd is not None]
        if cash_options:
            best = min(cash_options, key=lambda o: o.cash_usd or float("inf"))
            
            path.append(leg.destination)
            total_cash += best.cash_usd or 0
            total_time += best.duration_min or 480
            
            for t in travelers:
                payments[t].append(SolvedPayment(
                    edge=(leg.origin, leg.destination, best.option_id),
                    payment_type="cash",
                    payer=t,
                    fare=best.cash_usd,
                    mode="flight",
                ))
    
    if path[-1] != end_airport:
        path.append(end_airport)
    
    return SolvedItinerary(
        status="Cash-Only",
        paths={t: path for t in travelers},
        payments=payments,
        totals={
            "cash": total_cash,
            "airline_points": 0,
            "time": total_time,
            "points_value": 0,
        },
        transfers={t: {} for t in travelers},
        native_used={t: {} for t in travelers},
    )


async def run_optimization_with_relaxation(
    leg_options_map: Dict[ScheduledLeg, LegOptions],
    travelers: List[str],
    start_airport: str,
    end_airport: str,
    points_by_traveler: Dict[str, Dict[str, int]],
    max_budget_usd: Optional[int],
    run_id: str,
    must_visit_cities: Optional[List[str]] = None,
    benefit_airlines: Optional[Dict[str, set]] = None,
) -> Tuple[SolvedItinerary, Optional[str]]:
    """
    Run optimization with automatic budget relaxation if infeasible.
    
    Returns:
        Tuple of (SolvedItinerary, relaxation_message or None)
    """
    # First try with original budget
    solution = run_payment_optimization(
        leg_options_map=leg_options_map,
        travelers=travelers,
        start_airport=start_airport,
        end_airport=end_airport,
        points_by_traveler=points_by_traveler,
        max_budget_usd=max_budget_usd,
        run_id=run_id,
        must_visit_cities=must_visit_cities,
        benefit_airlines=benefit_airlines,
    )
    
    if solution.status == "Optimal":
        return solution, None
    
    # If infeasible, try relaxing the budget
    if solution.status == "Infeasible" and max_budget_usd:
        for multiplier in [2, 3, 5, 10]:
            relaxed_budget = max_budget_usd * multiplier
            
            relaxed = run_payment_optimization(
                leg_options_map=leg_options_map,
                travelers=travelers,
                start_airport=start_airport,
                end_airport=end_airport,
                points_by_traveler=points_by_traveler,
                max_budget_usd=relaxed_budget,
                run_id=run_id,
                must_visit_cities=must_visit_cities,
                benefit_airlines=benefit_airlines,
            )
            
            if relaxed.status == "Optimal" and any(relaxed.paths.values()):
                total_cash = relaxed.totals.get("cash", 0)
                message = (
                    f"Your budget of ${max_budget_usd:,} is too low for this trip. "
                    f"We found a route with a budget of ${relaxed_budget:,} (total cash: ${total_cash:,.0f}). "
                    f"Consider increasing your budget to at least ${relaxed_budget:,}."
                )
                return relaxed, message
        
        # Final fallback: cash-only with no budget constraint
        logger.info("All relaxation attempts failed, using cash-only solution")
        cash_solution = _cash_only_solution(
            leg_options_map, travelers, start_airport, end_airport
        )
        total = cash_solution.totals.get("cash", 0)
        message = (
            f"No feasible solution within your budget. "
            f"The lowest-cost route we found costs ${total:,.0f}. "
            f"Consider increasing your budget or adding more points."
        )
        return cash_solution, message
    
    return solution, None
