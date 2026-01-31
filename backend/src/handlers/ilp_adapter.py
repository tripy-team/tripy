# backend/ilp_adapter.py  (edges -> ILP inputs; user-selected meetup cities)
"""
ILP Adapter Module

This module transforms raw flight edge data into structured inputs
for the ILP optimization solver.

Refactored to use the optimization module for utilities and constants.
"""

import logging
from typing import Dict, List, Optional, Set, Tuple, Any

from src.utils.card_benefits import build_edge_to_airline

# Import from the new optimization module
from src.optimization.utils import (
    is_bank_key as _is_bank_key,
    normalize_bank_key as _normalize_bank_key,
    normalize_airline_code as _as_airline_code,
    split_balances,
)
from src.optimization.constants import (
    DEFAULT_TRANSFER_GRAPH,
    SOLVER_CONFIG,
)


_ilp_logger = logging.getLogger(__name__)


def _split_balances_for_trav(user_points_one: Dict, transfer_graph: Dict) -> Tuple[Dict, Dict]:
    """
    Split user points into bank (transferable) and airline (native) balances.
    
    Wrapper around optimization.utils.split_balances for backward compatibility.
    """
    return split_balances(user_points_one, transfer_graph)

def build_ilp_inputs_from_edges(
    edges_dict,
    travelers,
    start_city_by_trav,
    end_city_by_trav,
    user_points_by_trav,
    *,
    meetup_cities=None,
    require_meetup_in_graph=True,
    transfer_graph=None,
    transfer_bonuses=None,
    link_ok_overrides=None,
    bank_block_size=1000,
    default_cash_if_missing=1e7,
    default_time_if_missing=1e6,
    allow_all_payers=True,
    default_cash_budget=1e9,
):
    meetup_cities = list(meetup_cities or [])
    edges = list(edges_dict.keys())
    
    # Log what user points we received
    _ilp_logger.info(f"ILP adapter: user_points_by_trav = {user_points_by_trav}")
    
    # Sample edge data to understand what we're working with
    sample_edges = list(edges_dict.items())[:3]
    for e, d in sample_edges:
        _ilp_logger.info(f"ILP adapter: sample edge {e} -> points_program={d.get('points_program')}, points_cost={d.get('points_cost')}, cash_cost={d.get('cash_cost')}")

    city_set = set()
    for i, j, _ in edges:
        city_set.add(i)
        city_set.add(j)
    for t in travelers:
        if start_city_by_trav.get(t):
            city_set.add(start_city_by_trav[t])
        if end_city_by_trav.get(t):
            city_set.add(end_city_by_trav[t])

    missing = [c for c in meetup_cities if c not in city_set]
    if missing:
        if require_meetup_in_graph:
            raise ValueError("Meetup city(ies) not present in graph: %s" % missing)
        for c in missing:
            city_set.add(c)
    cities = sorted(city_set)

    airline_set = set()
    for e, d in edges_dict.items():
        al = _as_airline_code(d.get("points_program"))
        if al:
            airline_set.add(al)
    airlines = sorted(airline_set)

    time_cost = {}
    cash_cost = {}
    departure_time = {}
    arrival_time = {}
    for e, d in edges_dict.items():
        tval = d.get("time_cost")
        cval = d.get("cash_cost")
        time_cost[e] = (
            float(tval) if tval is not None else float(default_time_if_missing)
        )
        cash_cost[e] = (
            float(cval) if cval is not None else float(default_cash_if_missing)
        )
        # Extract departure/arrival times for chronological ordering constraints
        dep_str = d.get("departure_time")
        arr_str = d.get("arrival_time")
        departure_time[e] = dep_str
        arrival_time[e] = arr_str

    award_points = {a: {} for a in airlines}
    cash_surcharge = {a: {} for a in airlines}
    allowed_award_edge = {a: {} for a in airlines}
    for e, d in edges_dict.items():
        al = _as_airline_code(d.get("points_program"))
        pts = d.get("points_cost")
        sur = d.get("points_surcharge")
        for a in airlines:
            if al == a and pts is not None:
                award_points[a][e] = float(pts)
                cash_surcharge[a][e] = float(sur or 0.0)
                allowed_award_edge[a][e] = 1
            else:
                award_points[a][e] = award_points[a].get(e, 0.0)
                cash_surcharge[a][e] = cash_surcharge[a].get(e, 0.0)
                allowed_award_edge[a][e] = 0

    sources_by_trav, source_balances, miles_balance = {}, {}, {}
    for trav, balances in (user_points_by_trav or {}).items():
        banks, airlines_miles = _split_balances_for_trav(balances, transfer_graph)
        sources_by_trav[trav] = sorted(list(banks.keys()))
        for s, v in banks.items():
            source_balances[(trav, s)] = float(v or 0.0)
        for a, v in airlines_miles.items():
            miles_balance[(trav, a)] = float(v or 0.0)

    allowed_sa, ratio, bonus, inc_source = set(), {}, {}, {}
    tg = transfer_graph or {}
    tb = transfer_bonuses or {}
    for s, amap in tg.items():
        for a, r in (amap or {}).items():
            a_code = _as_airline_code(a)
            if a_code not in airlines:
                continue
            allowed_sa.add((s, a_code))
            ratio[(s, a_code)] = float(r)
            bonus[(s, a_code)] = float(tb.get((s, a_code), 1.0))
            inc_source[(s, a_code)] = int(max(1, bank_block_size))

    link_ok = {}
    for trav in travelers:
        banks = set(sources_by_trav.get(trav, []))
        for a in airlines:
            default_link = 0
            if (trav, a) in miles_balance and miles_balance[(trav, a)] > 0:
                default_link = 1
            else:
                for s in banks:
                    if (s, a) in allowed_sa:
                        default_link = 1
                        break
            if link_ok_overrides and (trav, a) in link_ok_overrides:
                link_ok[(trav, a)] = int(link_ok_overrides[(trav, a)])
            else:
                link_ok[(trav, a)] = int(default_link)
    
    # Log link_ok calculation results
    linked_pairs = [(t[-8:], a) for (t, a), ok in link_ok.items() if ok]
    not_linked_pairs = [(t[-8:], a) for (t, a), ok in link_ok.items() if not ok]
    _ilp_logger.info(f"ILP adapter: link_ok LINKED = {linked_pairs}")
    _ilp_logger.info(f"ILP adapter: link_ok NOT linked (sample 10) = {not_linked_pairs[:10]}...")
    _ilp_logger.info(f"ILP adapter: sources_by_trav = {sources_by_trav}")
    _ilp_logger.info(f"ILP adapter: miles_balance with value = {[(k, v) for k, v in miles_balance.items() if v > 0]}")

    budget_cash = {trav: float(default_cash_budget) for trav in travelers}
    can_pay_for = {}
    for q in travelers:
        for p in travelers:
            can_pay_for[(q, p)] = 1 if (allow_all_payers or q == p) else 0

    return {
        "travelers": travelers,
        "start_city": start_city_by_trav,
        "end_city": end_city_by_trav,
        "cities": cities,
        "edges": edges,
        "time_cost": time_cost,
        "cash_cost": cash_cost,
        "departure_time": departure_time,
        "arrival_time": arrival_time,
        "airlines": airlines,
        "award_points": award_points,
        "cash_surcharge": cash_surcharge,
        "allowed_award_edge": allowed_award_edge,
        "sources_by_trav": sources_by_trav,
        "source_balances": source_balances,
        "allowed_sa": allowed_sa,
        "ratio": ratio,
        "bonus": bonus,
        "inc_source": inc_source,
        "miles_balance": miles_balance,
        "link_ok": link_ok,
        "budget_cash": budget_cash,
        "can_pay_for": can_pay_for,
        "total_cash_seats": {},
        "award_seats": {},
        "meetup_cities": meetup_cities or [],
    }


def run_ilp_from_edges(
    edges_dict,
    travelers,
    start_city_by_trav,
    end_city_by_trav,
    user_points_by_trav,
    plan_fn,
    *,
    meetup_cities=None,
    require_meetup_in_graph=True,
    must_visit_cities=None,
    benefit_airlines=None,
    bag_fee=35.0,
    W_benefit=1e4,
    optimization_mode="oop",  # NEW: "oop" (minimize out-of-pocket) or "cpp" (maximize CPP)
    **adapter_kwargs,
):
    """
    Run ILP optimization from edge dictionary.
    
    Args:
        optimization_mode: "oop" to minimize out-of-pocket costs (default),
                          "cpp" to maximize cents-per-point value (original behavior)
    """
    ilp_in = build_ilp_inputs_from_edges(
        edges_dict,
        travelers,
        start_city_by_trav,
        end_city_by_trav,
        user_points_by_trav,
        meetup_cities=meetup_cities,
        require_meetup_in_graph=require_meetup_in_graph,
        **adapter_kwargs,
    )
    edge_to_airline = build_edge_to_airline(edges_dict)
    return plan_fn(
        ilp_in["travelers"],
        ilp_in["start_city"],
        ilp_in["end_city"],
        ilp_in["cities"],
        ilp_in["edges"],
        ilp_in["time_cost"],
        ilp_in["cash_cost"],
        ilp_in["airlines"],
        ilp_in["award_points"],
        ilp_in["cash_surcharge"],
        ilp_in["allowed_award_edge"],
        ilp_in["sources_by_trav"],
        ilp_in["source_balances"],
        ilp_in["allowed_sa"],
        ilp_in["ratio"],
        ilp_in["bonus"],
        ilp_in["inc_source"],
        ilp_in["miles_balance"],
        ilp_in["link_ok"],
        ilp_in["budget_cash"],
        ilp_in["can_pay_for"],
        ilp_in["total_cash_seats"],
        ilp_in["award_seats"],
        ilp_in["meetup_cities"],
        benefit_airlines=benefit_airlines,
        edge_to_airline=edge_to_airline,
        bag_fee=bag_fee,
        W_benefit=W_benefit,
        must_visit_cities=must_visit_cities,
        optimization_mode=optimization_mode,
        departure_time=ilp_in["departure_time"],
        arrival_time=ilp_in["arrival_time"],
    )
