import heapq
import os
import uuid
import logging
import re
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple
from src.repos import itinerary_repo
from src.handlers.flights import (
    get_flights_award_first_with_points_async,
    get_flights_serp_first_with_points_async,
    get_flights_serp_only,
)
from src.handlers.ilp_adapter import run_ilp_from_edges
try:
    from src.handlers.points_maximizer import plan_maximize_points_value
except ImportError:
    # Optional dependency (pulp) not installed; advanced ILP optimization will be unavailable
    plan_maximize_points_value = None  # type: ignore
    logger = logging.getLogger(__name__)
    logger.warning(
        "pulp / points_maximizer not available. Advanced optimized itineraries will be disabled. "
        "Install 'pulp' and ensure 'src.handlers.points_maximizer' is importable to enable it."
    )
from src.services import (
    destination_service,
    trip_service,
    points_service,
    trip_member_service,
    city_service,
)
from src.handlers.airport_filter import is_commercial_airport, load_commercial_iata_set_from_web
from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH, get_award_programs_for_api
from src.repos import user_repo
from src.utils.card_benefits import build_benefit_airlines_for_travelers

logger = logging.getLogger(__name__)

# Display names for transfer_tips (aligned with frontend transfer-instructions.ts)
_HUMANIZE_BANK: Dict[str, str] = {
    "amex": "Amex Membership Rewards",
    "chase": "Chase Ultimate Rewards",
    "citi": "Citi ThankYou Points",
    "capitalone": "Capital One Miles",
    "bilt": "Bilt Rewards",
}

_HUMANIZE_AIRLINE: Dict[str, str] = {
    "UA": "United MileagePlus", "AA": "American AAdvantage", "DL": "Delta SkyMiles",
    "AS": "Alaska Mileage Plan", "B6": "JetBlue TrueBlue", "AC": "Aeroplan",
    "BA": "British Airways Avios", "AF": "Air France / KLM Flying Blue", "KL": "KLM Flying Blue",
    "LH": "Lufthansa Miles & More", "LX": "Swiss Miles & More",
    "SQ": "Singapore KrisFlyer", "CX": "Cathay Asia Miles", "NH": "ANA Mileage Club", "JL": "JAL Mileage Bank",
    "EK": "Emirates Skywards", "QR": "Qatar Privilege Club", "EY": "Etihad Guest", "TK": "Turkish Miles&Smiles",
    "AV": "Avianca LifeMiles", "IB": "Iberia Avios", "QF": "Qantas Frequent Flyer", "VS": "Virgin Atlantic Flying Club",
    "KE": "Korean Air", "OZ": "Asiana", "CI": "China Airlines", "BR": "EVA Air",
}

# Small/regional airports that often lack direct long-haul flight data in SERP/AwardTool.
# When flight search returns no edges for origin->dest, we try (origin->hub) ground + (hub->dest) flights.
# Map: IATA -> list of nearby major hubs to try (closest first).
SMALL_AIRPORT_NEARBY_HUBS: Dict[str, List[str]] = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
    "SYR": ["BUF", "ALB", "EWR", "JFK"],           # Syracuse (if no CDG etc.)
}


def _parse_trip_duration_days(trip: Dict[str, Any]) -> int:
    """
    Best‑effort calculation of trip duration (in days) from start/end dates.
    When dates are empty (flexible), uses trip.durationDays / duration_days from user input.
    Falls back to 7 if missing.
    """
    start_date = (trip or {}).get("startDate") or ""
    end_date = (trip or {}).get("endDate") or ""

    try:
        if start_date and end_date and str(start_date).strip() and str(end_date).strip():
            start_dt = datetime.strptime(str(start_date).strip(), "%Y-%m-%d")
            end_dt = datetime.strptime(str(end_date).strip(), "%Y-%m-%d")
            days = (end_dt.date() - start_dt.date()).days or 1
            return max(days, 1)
    except Exception:
        pass

    # When dates are flexible/empty: use user-provided duration_days
    d = (trip or {}).get("durationDays") or (trip or {}).get("duration_days")
    if d is not None:
        try:
            n = int(d)
            if 1 <= n <= 365:
                return n
        except (TypeError, ValueError):
            pass
    return 7


def save_itinerary(trip_id: str, route: List[str]) -> Dict[str, Any]:
    # MVP: store one item that contains the chosen route as JSON
    item_id = "route"
    item = {"tripId": trip_id, "itemId": item_id, "type": "route", "route": route}
    itinerary_repo.put_item(item)
    return item


def get_itinerary(trip_id: str) -> List[Dict[str, Any]]:
    return itinerary_repo.list_items(trip_id)


def generate_simple_itineraries(trip_id: str) -> List[Dict[str, Any]]:
    """
    Lightweight, dependency‑free itinerary generator.

    Generates 1–5 itineraries within budget and points constraints. It:
      - Reads the trip (including maxBudget), destinations, and points summary
      - Builds route variants: Balanced, Reverse, Budget (fits max_budget), Explorer (more cities if under budget)
      - Ensures totalCost <= max_budget and pointsCost <= total_points when set
      - Adds withinBudget and withinPoints to each item for UI badges

    The frontend treats these as "routes" for display and comparison.
    """
    # Load trip + destinations
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")

    max_budget = trip.get("maxBudget") or trip.get("max_budget")
    if max_budget is not None:
        try:
            max_budget = int(max_budget)
        except (TypeError, ValueError):
            max_budget = None

    # Total points available for the trip
    total_points = 0
    try:
        summary = points_service.trip_points_summary(trip_id)
        total_points = int(summary.get("totalPoints") or 0)
    except Exception:
        pass

    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        raise ValueError("No destinations found for trip. Please add at least one destination.")

    # Filter out excluded destinations while preserving original order
    valid_dests: List[Dict[str, Any]] = [d for d in destinations if not d.get("excluded", False)]
    if not valid_dests:
        raise ValueError("All destinations are excluded. Please add at least one active destination.")

    # Determine start / end (mustInclude = True = departure/return airports; they are transit, not stays)
    must_include = [d for d in valid_dests if d.get("mustInclude", False)]
    if must_include:
        start_dest = must_include[0]
        end_dest = must_include[-1]
    else:
        start_dest = valid_dests[0]
        end_dest = valid_dests[-1] if len(valid_dests) > 1 else valid_dests[0]

    def _city_name(d: Dict[str, Any]) -> str:
        return (d.get("name") or d.get("destinationId") or "").strip()

    # When must_include exists: Start/End are departure/return airports (transit only, no days).
    # Stays = only "Destinations" (mustInclude: false). Route = start -> stays -> end.
    # When no must_include: first/last are inferred; all dests are stays. Route = valid_dests order.
    if must_include:
        stay_dests = [d for d in valid_dests if not d.get("mustInclude", False)]
        route_dests = [start_dest] + stay_dests + [end_dest]
    else:
        stay_dests = list(valid_dests)
        route_dests = list(valid_dests)

    stay_names = [_city_name(d) for d in stay_dests if _city_name(d)]
    stay_ids = [d.get("destinationId") for d in stay_dests if _city_name(d)]
    route_names = [_city_name(d) for d in route_dests if _city_name(d)]
    route_ids = [d.get("destinationId") for d in route_dests if _city_name(d)]

    total_days = _parse_trip_duration_days(trip)
    num_stops = max(len(stay_names), 1)
    base_days = max(total_days // num_stops, 2)

    # Align with user's includeHotels: lower costs when hotels excluded (flights + activities only)
    include_hotels = trip.get("includeHotels", True) is not False
    base_cost_per_day = 200 if include_hotels else 120
    base_cost_per_city = 300 if include_hotels else 200
    points_per_dollar = 25  # rough valuation

    def _build_city_objects(
        names: List[str],
        ids: List[Any],
        days_per: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        d = days_per if days_per is not None else base_days
        return [{"name": n, "days": d} for n in names if n]

    def _cost(city_objs: List[Dict[str, Any]]) -> int:
        stay = sum(c.get("days", base_days) for c in city_objs) or total_days
        return int(stay * base_cost_per_day + len(city_objs) * base_cost_per_city)

    def _points(cost: int) -> int:
        return int(cost * points_per_dollar)

    # ---- Build 1–10 route variants ----
    routes: List[Dict[str, Any]] = []

    # 1. Balanced (forward order): route = start -> stays -> end; only stays get days
    bal_cities = _build_city_objects(stay_names, stay_ids)
    routes.append({
        "label": "Balanced route",
        "route_ids": route_ids,
        "cities": bal_cities,
        "weight_factor": 1.0,
    })

    # 2. Reverse (if different): reverse only the stay order; start/end stay at path ends
    if len(stay_names) > 1:
        rev_route_ids = [route_ids[0]] + list(reversed(route_ids[1:-1])) + [route_ids[-1]]
        if rev_route_ids != route_ids:
            routes.append({
                "label": "Reverse route",
                "route_ids": rev_route_ids,
                "cities": _build_city_objects(list(reversed(stay_names)), list(reversed(stay_ids))),
                "weight_factor": 0.95,
            })

    # 3. Budget: keep all user destinations; only reduce days to fit max_budget (stays only)
    if max_budget is not None and max_budget > 0:
        n = max(len(stay_names), 1)
        room = max_budget - n * base_cost_per_city
        if room > 0:
            max_stay = room // base_cost_per_day
            budget_days = max(2, min(base_days, max_stay // n))
        else:
            budget_days = 2
        budget_cities = _build_city_objects(stay_names, stay_ids, days_per=budget_days)
        routes.append({
            "label": "Budget pick",
            "route_ids": route_ids,
            "cities": budget_cities,
            "weight_factor": 0.92,
        })

    # 4. Extended stay: add more days to longest city (when budget allows)
    if max_budget is None or max_budget > bal_cost * 1.3:
        extended_cities = _build_city_objects(stay_names, stay_ids, days_per=base_days + 2)
        routes.append({
            "label": "Extended stay",
            "route_ids": route_ids,
            "cities": extended_cities,
            "weight_factor": 0.98,
        })

    # 5. Quick trip: shorter days per city (minimum 2 days each)
    if len(stay_names) >= 2:
        quick_cities = _build_city_objects(stay_names, stay_ids, days_per=max(2, base_days - 1))
        routes.append({
            "label": "Quick trip",
            "route_ids": route_ids,
            "cities": quick_cities,
            "weight_factor": 0.90,
        })

    # 6. Explorer: more cities only if we're well under budget and have more stay destinations
    bal_cost = _cost(routes[0]["cities"])
    if (
        len(stay_names) >= 3
        and (max_budget is None or bal_cost <= (max_budget * 0.7))
        and len(routes) < 10
    ):
        expl_cities = _build_city_objects(stay_names, stay_ids)
        routes.append({
            "label": "Explorer",
            "route_ids": route_ids,
            "cities": expl_cities,
            "weight_factor": 1.02,
        })

    # 7-10. Variations with different day distributions (when we have 3+ destinations)
    if len(stay_names) >= 3 and len(routes) < 10:
        # Focus on first city
        focus_first = _build_city_objects(stay_names, stay_ids)
        if len(focus_first) >= 3:
            focus_first[0]["days"] = base_days + 2
            focus_first[-1]["days"] = max(2, base_days - 1)
            routes.append({
                "label": "Focus on arrival city",
                "route_ids": route_ids,
                "cities": focus_first,
                "weight_factor": 0.93,
            })
        
        # Focus on last city
        focus_last = _build_city_objects(stay_names, stay_ids)
        if len(focus_last) >= 3:
            focus_last[0]["days"] = max(2, base_days - 1)
            focus_last[-1]["days"] = base_days + 2
            routes.append({
                "label": "Focus on final city",
                "route_ids": route_ids,
                "cities": focus_last,
                "weight_factor": 0.93,
            })
        
        # Even split (all cities get equal days)
        even_days = max(2, total_days // len(stay_names))
        even_cities = _build_city_objects(stay_names, stay_ids, days_per=even_days)
        routes.append({
            "label": "Even split",
            "route_ids": route_ids,
            "cities": even_cities,
            "weight_factor": 0.96,
        })
        
        # Mixed pace (alternate between longer and shorter stays)
        if len(stay_names) >= 4:
            mixed_cities = _build_city_objects(stay_names, stay_ids)
            for i in range(len(mixed_cities)):
                mixed_cities[i]["days"] = (base_days + 1) if i % 2 == 0 else max(2, base_days - 1)
            routes.append({
                "label": "Mixed pace",
                "route_ids": route_ids,
                "cities": mixed_cities,
                "weight_factor": 0.94,
            })

    # Cap at 10
    routes = routes[:10]

    # ---- Build items with withinBudget / withinPoints ----
    items: List[Dict[str, Any]] = []
    existing_items = itinerary_repo.list_items(trip_id) or []
    existing_ids = {i.get("itemId") for i in existing_items}

    def _next_item_id(idx: int) -> str:
        candidate = f"itinerary_{idx}"
        n = idx
        while candidate in existing_ids:
            n += 1
            candidate = f"itinerary_{n}"
        existing_ids.add(candidate)
        return candidate

    for idx, r in enumerate(routes, start=1):
        city_objs = r["cities"]
        total_cost = _cost(city_objs)
        points_cost = _points(total_cost)

        within_budget = max_budget is None or max_budget <= 0 or total_cost <= max_budget
        within_points = total_points <= 0 or points_cost <= total_points

        score = 88
        if len(city_objs) >= 4:
            score += 4
        elif len(city_objs) >= 2:
            score += 2
        score = int(score * r.get("weight_factor", 1.0))
        if within_budget and within_points:
            score = min(99, score + 3)
        score = max(75, min(score, 99))

        item = {
            "tripId": trip_id,
            "itemId": _next_item_id(idx),
            "type": "itinerary",
            "name": r["label"],
            "route": r["route_ids"],
            "cities": city_objs,
            "totalCost": total_cost,
            "pointsCost": points_cost,
            "score": score,
            "withinBudget": within_budget,
            "withinPoints": within_points,
        }
        itinerary_repo.put_item(item)
        items.append(item)

    logger.info(
        f"Generated {len(items)} simple itineraries for trip {trip_id} "
        f"(max_budget={max_budget}, total_points={total_points}); "
        f"destinations={[c['name'] for c in (routes[0]['cities'] if routes else [])}"
    )
    return items


def _is_airport_code(name: str) -> bool:
    """Check if a string looks like an airport code (3 uppercase letters)"""
    return bool(re.match(r'^[A-Z]{3}$', name.strip().upper()))


def _normalize_city_to_code(city_name: str) -> Optional[str]:
    """
    Convert city name to airport code.
    If already a code, return it. Otherwise, try to find the primary airport.
    Handles formats like:
    - "JFK" -> "JFK"
    - "New York" -> searches for airport
    - "New York (JFK,LGA,EWR)" -> extracts "JFK" (first code)
    """
    city_name = city_name.strip()
    
    # If it's already an airport code, return it
    if _is_airport_code(city_name):
        return city_name.upper()
    
    # Check if it's in format "City (CODE1,CODE2,CODE3)" and extract first code
    import re
    code_match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if code_match:
        # Extract first airport code from comma-separated list
        codes = code_match.group(1).split(',')
        first_code = codes[0].strip()
        if _is_airport_code(first_code):
            return first_code.upper()
    
    # Try to find airport code using city search
    # Remove the airport codes part if present for searching
    search_name = re.sub(r'\s*\([A-Z]{3}(?:,[A-Z]{3})*\)', '', city_name).strip()
    
    try:
        results = city_service.search_cities(search_name, max_results=5)
        if results:
            # Prefer airport type results
            for result in results:
                iata_code = result.get("iataCode", "")
                if iata_code and _is_airport_code(iata_code):
                    return iata_code.upper()
            
            # Fallback to first result with IATA code
            for result in results:
                iata_code = result.get("iataCode", "")
                if iata_code:
                    return iata_code.upper()
    except Exception as e:
        logger.warning(f"Error searching for airport code for {city_name}: {e}")

    # Fallback: try OpenAI for small/remote cities not in our static/Amadeus data
    try:
        from src.handlers.openAI import find_commercial_airports_for_city
        ai_airports = find_commercial_airports_for_city(search_name, max_results=3)
        for a in ai_airports:
            code = (a.get("iata_code") or "").upper().strip()
            if code and _is_airport_code(code):
                return code
    except Exception as e:
        logger.debug(f"OpenAI airport lookup for {city_name}: {e}")
    
    # If search fails, try to extract code from name (e.g., "New York (JFK)" or "New York (JFK,LGA,EWR)")
    # Handle both single code and multiple codes
    match = re.search(r'\(([A-Z]{3}(?:,[A-Z]{3})*)\)', city_name.upper())
    if match:
        # Extract first airport code from comma-separated list
        codes = match.group(1).split(',')
        first_code = codes[0].strip()
        if _is_airport_code(first_code):
            return first_code.upper()
    
    return None


def _validate_date(date_str: str, field_name: str = "date") -> None:
    """Validate date format and ensure it's in the future"""
    if not date_str or not date_str.strip():
        raise ValueError(f"{field_name} is required")
    
    try:
        # Try common date formats
        for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%m/%d/%Y", "%d/%m/%Y"]:
            try:
                date_obj = datetime.strptime(date_str.strip(), fmt)
                # Check if date is in the future (allow today)
                if date_obj.date() < datetime.now().date():
                    raise ValueError(f"{field_name} must be today or in the future")
                return
            except ValueError:
                continue
        raise ValueError(f"{field_name} format is invalid. Use YYYY-MM-DD format")
    except ValueError as e:
        if "must be today" in str(e) or "format is invalid" in str(e):
            raise
        raise ValueError(f"{field_name} format is invalid. Use YYYY-MM-DD format")


def _best_effort_path_from_edges(
    edges_dict: Dict[Tuple[str, str, str], Dict[str, Any]],
    start_city_by_trav: Dict[str, str],
    end_city_by_trav: Dict[str, str],
    travelers: List[str],
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """
    Find the minimum cash-cost path from start to end in the graph.
    Returns (solution_dict, message) or (None, None) if no path exists.
    Used when ILP is infeasible to suggest a route that may exceed budget/points.
    """
    if not travelers:
        return (None, None)
    start = start_city_by_trav.get(travelers[0]) or ""
    end = end_city_by_trav.get(travelers[0]) or ""
    if not start or not end:
        return (None, None)

    # For each (i,j) keep the edge with minimum cash_cost
    best: Dict[Tuple[str, str], Tuple[Tuple[str, str, str], float]] = {}
    for (i, j, k), d in edges_dict.items():
        try:
            cost = float(d.get("cash_cost") or 1e7)
        except (TypeError, ValueError):
            cost = 1e7
        if (i, j) not in best or cost < best[(i, j)][1]:
            best[(i, j)] = ((i, j, k), cost)

    adj: Dict[str, List[Tuple[str, float, Tuple[str, str, str]]]] = {}
    for (i, j), (edge, cost) in best.items():
        adj.setdefault(i, []).append((j, cost, edge))

    # Dijkstra
    INF = 10 ** 9
    dist: Dict[str, float] = {start: 0.0}
    parent: Dict[str, Tuple[str, Tuple[str, str, str]]] = {}
    heap: List[Tuple[float, str]] = [(0.0, start)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == end:
            break
        if d > dist.get(u, INF):
            continue
        for v, cost, edge in adj.get(u, []):
            nd = d + cost
            if nd < dist.get(v, INF):
                dist[v] = nd
                parent[v] = (u, edge)
                heapq.heappush(heap, (nd, v))

    if end not in parent:
        return (None, None)

    # Recover path edges
    path_edges: List[Tuple[str, str, str]] = []
    cur = end
    while cur in parent:
        u, e = parent[cur]
        path_edges.append(e)
        cur = u
    path_edges.reverse()
    path_nodes = [start] + [e[1] for e in path_edges]

    # Build pay_mode (all cash) and totals
    total_cash = 0.0
    total_time = 0.0
    payer = travelers[0]
    pay_list: List[Dict[str, Any]] = []
    for e in path_edges:
        d = edges_dict.get(e, {})
        try:
            cash = float(d.get("cash_cost") or 0)
        except (TypeError, ValueError):
            cash = 0.0
        try:
            total_time += float(d.get("time_cost") or 0)
        except (TypeError, ValueError):
            pass
        total_cash += cash
        pay_list.append({
            "edge": [e[0], e[1], e[2]],
            "type": "cash",
            "payer": payer,
            "fare": cash,
        })

    solution: Dict[str, Any] = {
        "status": "Optimal",
        "path": {t: list(path_nodes) for t in travelers},
        "edges": {t: [[e[0], e[1], e[2]] for e in path_edges] for t in travelers},
        "pay_mode": {t: list(pay_list) for t in travelers},
        "totals": {
            "airline_points": 0.0,
            "cash": total_cash,
            "time": total_time,
            "points_value": 0.0,
            "transfers": {q: {} for q in travelers},
            "native_used": {q: {} for q in travelers},
        },
    }
    msg = (
        "No feasible solution within your budget and points. "
        "Shown below is the lowest-cost route we found; it may exceed your limits. "
        "Consider increasing your budget, adding more points, or reducing destinations/days."
    )
    return (solution, msg)


def build_transfer_tips_from_solution(
    solution: Dict[str, Any],
    _edges_all: Optional[Dict[Any, Dict[str, Any]]] = None,
) -> List[Dict[str, Any]]:
    """
    Build transfer_tips from the optimized solution's pay_mode, using AwardTool-derived
    award_points and program. Each tip: where to transfer, how many points, for which segment.
    When edges_all is provided, includes operating carrier (e.g. Korean Air codeshare via Delta).
    Replaces generic AI transfer advice with data-driven amounts and partners.
    Also includes strategy_reason explaining why this transfer strategy was selected.
    """
    out: List[Dict[str, Any]] = []
    pay_mode = solution.get("pay_mode") or {}
    edges_all = _edges_all or {}
    
    # Build strategy reasoning from solution metadata
    strategy_reasons = []
    total_points = 0
    programs_used = set()
    partners_used = set()

    for _traveler, recs in pay_mode.items():
        for rec in (recs or []):
            if rec.get("type") != "points":
                continue
            via = rec.get("via") or {}
            miles = rec.get("miles")
            if miles is None:
                continue
            miles = int(float(miles))
            sur = rec.get("surcharge")
            try:
                sur_val = float(sur) if sur is not None else None
            except (TypeError, ValueError):
                sur_val = None

            edge = rec.get("edge")
            if isinstance(edge, (list, tuple)) and len(edge) >= 2:
                dep, arr = str(edge[0] or "").upper(), str(edge[1] or "").upper()
                best_for = f"{dep}→{arr}" if (dep and arr) else None
            else:
                best_for = None

            # Operating carrier from AwardTool (codeshare): e.g. KE when booking via DL
            operating_airline = None
            e_tuple = tuple(edge) if isinstance(edge, (list, tuple)) and len(edge) >= 3 else None
            if e_tuple and e_tuple in edges_all:
                op = (edges_all[e_tuple].get("operating_airline") or "").strip().upper()
                if op and len(op) >= 2:
                    operating_airline = op[:2]
            booking_airline = (via.get("airline") or via.get("native") or "").upper().strip()
            codeshare_suffix = ""
            if operating_airline and operating_airline != booking_airline:
                op_name = _HUMANIZE_AIRLINE.get(operating_airline) or operating_airline
                codeshare_suffix = f" to book {op_name} (codeshare via {_HUMANIZE_AIRLINE.get(booking_airline) or booking_airline})."

            if "source" in via and "airline" in via:
                src = (via.get("source") or "").lower().strip()
                al = (via.get("airline") or "").upper().strip()
                from_program = _HUMANIZE_BANK.get(src) or src or "Credit card points"
                to_program = _HUMANIZE_AIRLINE.get(al) or al or "Travel partner"
                note = f"Transfer {miles:,} points to {to_program}{codeshare_suffix}"
                if sur_val is not None and sur_val > 0:
                    note += f" Pay ~${sur_val:,.0f} in taxes and fees."
                note += " From AwardTool award availability."
            elif "native" in via:
                al = (via.get("native") or "").upper().strip()
                to_program = _HUMANIZE_AIRLINE.get(al) or al or "Travel partner"
                from_program = "Existing miles"
                note = f"Use {miles:,} {to_program} miles (no transfer needed){codeshare_suffix}"
                if sur_val is not None and sur_val > 0:
                    note += f" Pay ~${sur_val:,.0f} in taxes and fees."
                note += " From AwardTool award availability."
            else:
                continue

            tip = {
                "from_program": from_program,
                "to_program": to_program,
                "best_for": best_for,
                "note": note,
                "points": miles,
                "surcharge": sur_val,
                "booking_airline": booking_airline,
                "booking_airline_name": _HUMANIZE_AIRLINE.get(booking_airline) or booking_airline,
            }
            if operating_airline and operating_airline != booking_airline:
                tip["operating_carrier"] = operating_airline
                op_name = _HUMANIZE_AIRLINE.get(operating_airline) or operating_airline
                tip["operating_carrier_name"] = op_name
                tip["segment_description"] = f"{op_name} (codeshare)"
                tip["is_codeshare"] = True
            else:
                tip["is_codeshare"] = False
            out.append(tip)
            
            # Track for strategy summary
            total_points += miles
            if from_program and from_program != "Existing miles":
                programs_used.add(from_program)
            partners_used.add(to_program)

    # Build strategy reasoning
    if out:
        if len(programs_used) == 1:
            strategy_reasons.append(f"This strategy uses {list(programs_used)[0]} as your primary points source")
        elif len(programs_used) > 1:
            strategy_reasons.append(f"This strategy optimizes across {len(programs_used)} credit card programs")
        
        if len(partners_used) == 1:
            strategy_reasons.append(f"transferring to {list(partners_used)[0]} for best award availability")
        elif len(partners_used) > 1:
            strategy_reasons.append(f"leveraging {len(partners_used)} airline partners for optimal routing and availability")
        
        strategy_reasons.append("based on live award availability from AwardTool")
        
        # Add strategy_reason to first tip (will be used for overview display)
        if strategy_reasons and out:
            out[0]["strategy_reason"] = ". ".join(s.capitalize() for s in strategy_reasons) + "."

    return out


async def _get_transfer_tips_from_panorama(
    origin: str,
    destination: str,
    start_date: str,
    end_date: str,
    user_banks: List[str],
) -> List[Dict[str, Any]]:
    """
    Fallback: use AwardTool Panorama (calendar) to get program + points for the route,
    then suggest where to transfer. Used when the optimizer has no points bookings.
    """
    import httpx
    api_key = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
    if not api_key or not origin or not destination:
        return []

    url = "https://www.awardtool-api.com/panorama/panorama_calendar_data"
    payload = {"id": f"{str(origin).upper()}-{str(destination).upper()}", "api_key": api_key}
    try:
        async with httpx.AsyncClient(http2=True, timeout=httpx.Timeout(20.0)) as client:
            r = await client.post(url, json=payload)
            r.raise_for_status()
            data = r.json().get("data") or []
    except Exception as e:
        logger.debug("Panorama calendar for transfer tips %s->%s: %s", origin, destination, e)
        return []

    banks_set = {b.lower().strip() for b in user_banks}
    best_pts, best_prog = None, None
    for row in data:
        d = row.get("date") or ""
        if start_date and d < start_date:
            continue
        if end_date and d > end_date:
            continue
        prog = (row.get("program") or "").upper()
        if not prog:
            continue
        pts_obj = row.get("points") or {}
        pts = pts_obj.get("y") if isinstance(pts_obj.get("y"), (int, float)) else None
        if pts is None:
            continue
        if best_pts is None or pts < best_pts:
            if DEFAULT_TRANSFER_GRAPH and any(
                DEFAULT_TRANSFER_GRAPH.get(b, {}).get(prog) is not None
                for b in banks_set
            ):
                best_pts, best_prog = int(pts), prog

    if best_pts is None or best_prog is None:
        return []

    from_bank = None
    for b in banks_set:
        if DEFAULT_TRANSFER_GRAPH.get(b, {}).get(best_prog) is not None:
            from_bank = b
            break
    if not from_bank:
        return []

    from_program = _HUMANIZE_BANK.get(from_bank) or from_bank
    to_program = _HUMANIZE_AIRLINE.get(best_prog) or best_prog
    best_for = f"{str(origin).upper()}→{str(destination).upper()}"
    note = f"Transfer {best_pts:,} points to {to_program} (AwardTool Panorama economy for your dates)."
    return [{
        "from_program": from_program,
        "to_program": to_program,
        "best_for": best_for,
        "note": note,
        "points": best_pts,
        "surcharge": None,
    }]


def _save_and_return_ai_route_suggestions(
    trip_id: str,
    origin: str,
    destination: str,
    city_names: List[str],
    start_date: str,
    end_date: str,
    failed_routes: Optional[List[str]] = None,
    points_programs: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """When flight search has no data (small/remote cities), use OpenAI to suggest routes and smart tips; return that instead of failing."""
    from src.handlers.openAI import suggest_routes_for_remote_or_small_cities, get_itinerary_smart_tips

    suggestions = suggest_routes_for_remote_or_small_cities(
        origin=origin,
        destination=destination,
        city_names=city_names if city_names else None,
        start_date=start_date or None,
        end_date=end_date or None,
        failed_routes=failed_routes,
    )
    tips = get_itinerary_smart_tips(
        origin=origin,
        destination=destination,
        city_names=city_names if city_names else None,
        start_date=start_date or None,
        end_date=end_date or None,
        points_programs=points_programs or None,
    )
    item = {
        "tripId": trip_id,
        "itemId": "ai_route_suggestions",
        "type": "ai_route_suggestions",
        "suggestions": suggestions,
        "transfer_tips": tips.get("transfer_tips", []),
        "sample_itineraries": tips.get("sample_itineraries", []),
        "holiday_advice": tips.get("holiday_advice", []),
        "practical_tips": tips.get("practical_tips", []),
    }
    itinerary_repo.put_item(item)
    return {
        "status": "ai_suggested",
        "ai_suggested_routes": True,
        "suggestions": suggestions,
        "items": [item],
        "solution": {},
    }


async def generate_optimized_itinerary(trip_id: str) -> Dict[str, Any]:
    """
    Generate optimized itinerary using points maximization algorithm.
    
    This function:
    1. Gets trip data (dates, destinations, members)
    2. Gets points for all members
    3. Converts city names to airport codes
    4. Fetches flight edges for all routes
    5. Runs ILP optimization to maximize points value
    6. Saves and returns the optimized itinerary
    
    Raises:
        ValueError: If trip data is invalid, missing required fields, or optimization fails
    """
    if plan_maximize_points_value is None:
        raise ValueError(
            "Optimized itineraries are not available in this environment because the "
            "'pulp' dependency (used by points_maximizer) is not installed. "
            "You can still use the basic itinerary generator."
        )
    # 1. Get trip data with validation
    trip = trip_service.get_trip(trip_id)
    if not trip:
        raise ValueError(f"Trip {trip_id} not found")
    
    start_date = trip.get("startDate", "")
    end_date = trip.get("endDate", "")
    
    # Validate dates
    try:
        _validate_date(start_date, "startDate")
        _validate_date(end_date, "endDate")
    except ValueError as e:
        raise ValueError(f"Invalid trip dates: {str(e)}")
    
    # Ensure end date is after start date
    try:
        start_dt = datetime.strptime(start_date.strip(), "%Y-%m-%d")
        end_dt = datetime.strptime(end_date.strip(), "%Y-%m-%d")
        if end_dt < start_dt:
            raise ValueError("endDate must be after or equal to startDate")
    except ValueError as e:
        if "must be after" in str(e):
            raise
        # If date parsing fails, continue (already validated above)
    
    # 2. Get destinations with validation
    destinations = destination_service.list_destinations(trip_id)
    if not destinations:
        raise ValueError("No destinations found for trip. Please add at least one destination.")
    
    # Filter out excluded destinations
    valid_destinations = [d for d in destinations if not d.get("excluded", False)]
    if not valid_destinations:
        raise ValueError("All destinations are excluded. Please add at least one active destination.")
    
    # Find start and end destinations (must_include=True destinations, or first/last if none)
    start_dest_name = None
    end_dest_name = None

    must_include = [d for d in valid_destinations if d.get("mustInclude", False)]
    if must_include:
        start_dest_name = must_include[0].get("name", "").strip()
        end_dest_name = must_include[-1].get("name", "").strip()
    if start_dest_name is None and valid_destinations:
        start_dest_name = valid_destinations[0].get("name", "").strip()
        end_dest_name = valid_destinations[-1].get("name", "").strip() if len(valid_destinations) > 1 else start_dest_name

    if not start_dest_name:
        raise ValueError("No valid start destination found")
    if not end_dest_name:
        end_dest_name = start_dest_name

    # Cities = all destinations between start and end (in valid_destinations order).
    # This includes middle must_include destinations so Paris->Amsterdam->Berlin all appear when all are requested.
    cities = []
    for d in valid_destinations:
        name = (d.get("name") or "").strip()
        if name and name not in (start_dest_name, end_dest_name):
            cities.append(name)
    
    # Convert city names to airport codes
    logger.info(f"Converting city names to airport codes: start={start_dest_name}, end={end_dest_name}, cities={cities}")
    
    start_dest_code = _normalize_city_to_code(start_dest_name)
    if not start_dest_code:
        logger.info(f"No airport code for start '{start_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )

    end_dest_code = _normalize_city_to_code(end_dest_name) if end_dest_name else start_dest_code
    if not end_dest_code:
        logger.info(f"No airport code for end '{end_dest_name}'; using OpenAI to suggest routes for small/remote city")
        return _save_and_return_ai_route_suggestions(
            trip_id, start_dest_name, end_dest_name or start_dest_name, cities, start_date, end_date, failed_routes=None
        )
    
    # Convert intermediate cities
    city_codes = []
    for city_name in cities:
        city_code = _normalize_city_to_code(city_name)
        if city_code:
            city_codes.append(city_code)
        else:
            logger.warning(f"Could not find airport code for '{city_name}', skipping")
    
    # For single destination trips, ensure we have at least start and end
    if not city_codes and start_dest_code == end_dest_code:
        logger.info(f"Single destination trip: {start_dest_code}")
        # For round trips, we still need at least 2 cities for the optimizer
        # Use the same city as both start and end
        city_codes = [start_dest_code]
    
    # 3. Get trip members with validation
    members = trip_member_service.list_members(trip_id)
    if not members:
        raise ValueError("No members found for trip. Please add at least one member.")
    
    travelers = [m.get("userId", "") for m in members if m.get("status") == "active"]
    if not travelers:
        raise ValueError("No active members found. Please ensure at least one member has active status.")
    
    if len(travelers) == 0:
        raise ValueError("No active travelers found for optimization")
    
    logger.info(f"Found {len(travelers)} active travelers: {travelers}")

    # Out-of-pocket optimizer for simple A->B round-trips (SerpAPI cash + AwardTool points/surcharge)
    oop_result: Optional[Dict[str, Any]] = None
    if (
        start_dest_code
        and end_dest_code
        and start_dest_code != end_dest_code
        and not city_codes
        and start_date
        and end_date
        and travelers
    ):
        try:
            from src.services.serp_api_functions import optimize_itinerary_out_of_pocket

            oop_result = optimize_itinerary_out_of_pocket(
                origin=start_dest_code,
                destination=end_dest_code,
                outbound_date=start_date.strip(),
                return_date=end_date.strip(),
                programs=get_award_programs_for_api(),
                cabins=["Economy"],
                pax=len(travelers),
            )
        except Exception as e:
            logger.warning("optimize_itinerary_out_of_pocket failed: %s", e)
            oop_result = None

    # Hotel out-of-pocket: AwardTool (cash + points) + SerpAPI Google Hotels (cash) for simple trips
    # Only when trip has includeHotels=True (default); allows excluding hotels from calculations
    oop_hotels_result: Optional[Dict[str, Any]] = None
    if (
        trip.get("includeHotels", True)
        and (end_dest_name or end_dest_code)
        and start_date
        and end_date
        and travelers
        and not city_codes
    ):
        try:
            from src.services.serp_api_functions import optimize_hotels_out_of_pocket

            oop_hotels_result = optimize_hotels_out_of_pocket(
                destination=(end_dest_name or end_dest_code or "").strip(),
                check_in=start_date.strip(),
                check_out=end_date.strip(),
                programs=None,
                guests=len(travelers),
                hotel_class=None,
            )
        except Exception as e:
            logger.warning("optimize_hotels_out_of_pocket failed: %s", e)
            oop_hotels_result = None

    # 4. Get points for all members with validation
    points_summary = points_service.trip_points_summary(trip_id)
    points_items = points_summary.get("items", [])
    
    # Build user_points_by_trav: {userId: {program: balance}}
    user_points_by_trav = {}
    total_points = 0
    for item in points_items:
        user_id = item.get("userId", "")
        program = item.get("program", "")
        try:
            balance = int(item.get("balance", 0))
        except (ValueError, TypeError):
            logger.warning(f"Invalid points balance for user {user_id}, program {program}: {item.get('balance')}")
            continue
        
        if user_id and program and balance > 0:
            if user_id not in user_points_by_trav:
                user_points_by_trav[user_id] = {}
            # Normalize program name to lowercase for transfer graph matching
            program_lower = program.lower().strip()
            user_points_by_trav[user_id][program_lower] = balance
            total_points += balance
    
    # Warn if no points found, but don't fail (optimization can still work with cash)
    if not user_points_by_trav or total_points == 0:
        logger.warning(
            f"No points found for trip {trip_id}. Optimization will prioritize cash bookings. "
            f"Consider adding points to maximize value."
        )
    else:
        logger.info(f"Total points available: {total_points:,} across {len(user_points_by_trav)} users")
    
    # 5. Build start/end city mapping using airport codes (for now, all travelers use same start/end)
    start_city_by_trav = {t: start_dest_code for t in travelers}
    end_city_by_trav = {t: end_dest_code for t in travelers}
    
    # 6. Fetch flight edges using airport codes
    # Build all possible routes: start -> city1 -> city2 -> ... -> end
    # For round-trip (start==end with cities), include the return leg so we fetch e.g. ITH->CDG and CDG->ITH
    all_cities = [start_dest_code] + city_codes
    if end_dest_code != start_dest_code or city_codes:
        all_cities = all_cities + [end_dest_code]
    # Deduplicate only when not a round-trip (avoid collapsing ITH->CDG->ITH into ITH->CDG)
    if not (len(all_cities) > 1 and all_cities[0] == all_cities[-1]):
        all_cities = list(dict.fromkeys(all_cities))
    
    if len(all_cities) < 2:
        raise ValueError(
            f"Need at least 2 distinct destinations for optimization. "
            f"Found: {all_cities}. Please add more destinations or use different start/end locations."
        )
    
    # Fetch edges for all O–D pairs so the optimizer can choose the cheapest ordering of
    # destinations (start/end fixed; middle cities can reorder to reduce cost).
    nodes = list(dict.fromkeys(all_cities))
    logger.info(f"Optimizing route over {nodes} (start={start_dest_code}, end={end_dest_code}); order flexible for {len(city_codes)} cities")
    
    edges_all = {}
    transfer_graph = DEFAULT_TRANSFER_GRAPH
    successful_routes = 0
    failed_routes = []
    pairs = [(o, d) for o in nodes for d in nodes if o != d]
    
    for origin, dest in pairs:
        # Use combined points from all travelers for fetching
        combined_points = {}
        for user_id, points in user_points_by_trav.items():
            for prog, bal in points.items():
                combined_points[prog] = combined_points.get(prog, 0) + bal
        
        # If no points, use empty dict (will fetch cash options)
        if not combined_points:
            combined_points = {}
        
        # Use end_date for return legs (back to origin) so we search the correct date
        leg_date = end_date.strip() if (dest == start_dest_code and end_date) else start_date.strip()
        filters = {
            "outbound_date": leg_date,
            "travel_class": "economy",
            "bags": 1,
            "pax": len(travelers),
            "award_programs": get_award_programs_for_api(),
        }

        serp_ok = "set" if (os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")) else "missing"
        award_ok = "set" if (os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")) else "missing"
        logger.info("fetch_flights [%s]->[%s] date=%s pax=%s SERPAPI_KEY=%s AWARD_TOOL_API_KEY=%s", origin, dest, leg_date, len(travelers), serp_ok, award_ok)

        try:
            edges = await get_flights_award_first_with_points_async(
                origin, dest, combined_points, filters
            )
            
            # If no edges found, try SERP-first strategy as fallback
            if not edges:
                logger.info(f"No edges from award-first strategy, trying SERP-first for {origin} -> {dest}")
                edges = await get_flights_serp_first_with_points_async(
                    origin, dest, combined_points, filters
                )
            # If still no edges, try sync serp_client.get_flights_between_airports (get_flights_serp_only)
            if not edges:
                logger.info(f"No edges from SERP-first, trying get_flights_serp_only (serp_client) for {origin} -> {dest}")
                edges = get_flights_serp_only(origin, dest, leg_date, filters)
            
            # Note: We already allow multistop flights by default (no stops restriction in filters)
            # If still no edges found, the route may not exist or dates may be invalid
            
            if edges:
                edges_all.update(edges)
                successful_routes += 1
                logger.info("Fetched %d flight edges from %s to %s", len(edges), origin, dest)

            # Add bus and car options for this segment (AI-rover style multi-modal)
            try:
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                ground_opts = get_bus_and_car_options(origin, dest, date=leg_date)
                ground_edges = ground_options_to_edges(origin, dest, ground_opts)
                if ground_edges:
                    edges_all.update(ground_edges)
                    logger.info("Added %d ground edges (bus/car) from %s to %s", len(ground_edges), origin, dest)
            except Exception as g:
                logger.debug("Ground transport for [%s]->[%s]: %s", origin, dest, g)

            if not edges:
                # Try nearby major hub when origin is a small/regional airport (e.g. ITH, BGM)
                hub_used = False
                if origin in SMALL_AIRPORT_NEARBY_HUBS:
                    from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                    for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                        try:
                            hub_edges = await get_flights_award_first_with_points_async(
                                hub, dest, combined_points, filters
                            )
                            if not hub_edges:
                                hub_edges = await get_flights_serp_first_with_points_async(
                                    hub, dest, combined_points, filters
                                )
                            if not hub_edges:
                                hub_edges = get_flights_serp_only(hub, dest, leg_date, filters)
                            if hub_edges:
                                ground_opts = get_bus_and_car_options(origin, hub, date=leg_date)
                                ground_edges = ground_options_to_edges(origin, hub, ground_opts)
                                if ground_edges:
                                    edges_all.update(hub_edges)
                                    edges_all.update(ground_edges)
                                    successful_routes += 1
                                    logger.info(
                                        "Used nearby hub %s for %s->%s: %d flight + %d ground edges (drive/ride to hub first)",
                                        hub, origin, dest, len(hub_edges), len(ground_edges),
                                    )
                                    hub_used = True
                                    break
                        except Exception as h:
                            logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
                if not hub_used:
                    failed_routes.append(f"{origin} -> {dest}")
                    logger.warning(
                        "No flight edges from %s to %s date=%s after award-first, SERP-first, get_flights_serp_only, and nearby-hub (if applicable). "
                        "Check SERPAPI_KEY, AWARD_TOOL_API_KEY, dates, and flights.SERP/AwardTool logs.",
                        origin, dest, leg_date,
                    )
        except Exception as e:
            failed_routes.append(f"{origin} -> {dest}")
            logger.warning(
                "Error fetching flights from %s to %s date=%s: %s. "
                "Check flights.SERP and flights.AwardTool logs.",
                origin, dest, leg_date, e, exc_info=True,
            )
            # Try SERP-first as fallback even on exception
            edges = {}
            try:
                logger.info(f"Trying SERP-first fallback after exception for {origin} -> {dest}")
                edges = await get_flights_serp_first_with_points_async(
                    origin, dest, combined_points, filters
                )
                if edges:
                    edges_all.update(edges)
                    successful_routes += 1
                    logger.info(f"Fallback SERP-first succeeded: {len(edges)} edges from {origin} to {dest}")
            except Exception as fallback_error:
                logger.warning(f"Fallback SERP-first also failed for {origin} -> {dest}: {fallback_error}")
            if not edges:
                try:
                    edges = get_flights_serp_only(origin, dest, leg_date, filters)
                    if edges:
                        edges_all.update(edges)
                        successful_routes += 1
                        logger.info(f"Fallback get_flights_serp_only succeeded: {len(edges)} edges from {origin} to {dest}")
                except Exception as serp_only_err:
                    logger.debug(f"get_flights_serp_only for {origin}->{dest}: {serp_only_err}")
            # If still no edges, try nearby hub for small/regional origin
            if not edges and origin in SMALL_AIRPORT_NEARBY_HUBS:
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
                    try:
                        hub_edges = await get_flights_award_first_with_points_async(hub, dest, combined_points, filters)
                        if not hub_edges:
                            hub_edges = await get_flights_serp_first_with_points_async(hub, dest, combined_points, filters)
                        if not hub_edges:
                            hub_edges = get_flights_serp_only(hub, dest, leg_date, filters)
                        if hub_edges:
                            ground_opts = get_bus_and_car_options(origin, hub, date=leg_date)
                            ground_edges = ground_options_to_edges(origin, hub, ground_opts)
                            if ground_edges:
                                edges_all.update(hub_edges)
                                edges_all.update(ground_edges)
                                successful_routes += 1
                                failed_routes.pop()  # remove the append we did above
                                logger.info(
                                    "Exception path: used nearby hub %s for %s->%s: %d flight + %d ground edges",
                                    hub, origin, dest, len(hub_edges), len(ground_edges),
                                )
                                break
                    except Exception as h:
                        logger.debug("Hub %s fallback for %s->%s: %s", hub, origin, dest, h)
            # Still add bus/car so the segment is not missing when flights fail
            try:
                from src.handlers.ground_transport import get_bus_and_car_options, ground_options_to_edges
                ground_opts = get_bus_and_car_options(origin, dest, date=leg_date)
                ground_edges = ground_options_to_edges(origin, dest, ground_opts)
                if ground_edges:
                    edges_all.update(ground_edges)
            except Exception:
                pass
            continue
    
    if not edges_all:
        # No flight data for any route (small/remote cities or API limits). Use OpenAI to suggest routes.
        logger.info(
            f"No flight edges for any route (failed: {failed_routes}); using OpenAI to suggest routes for small/remote cities"
        )
        return _save_and_return_ai_route_suggestions(
            trip_id,
            start_dest_name or start_dest_code,
            end_dest_name or end_dest_code,
            cities,
            start_date,
            end_date,
            failed_routes=failed_routes,
            points_programs=list({p for u in user_points_by_trav.values() for p in u}),
        )
    
    if successful_routes == 0:
        logger.warning(
            "No flight edges for any segment (failed: %s); optimizing with bus/car only where available.",
            ", ".join(failed_routes) if failed_routes else "all",
        )
    
    if failed_routes:
        logger.warning(f"Some routes failed to fetch flights: {', '.join(failed_routes)}. Continuing with available routes.")
    
    logger.info(f"Running ILP optimization with {len(edges_all)} edges for {len(travelers)} travelers")

    # Card benefits: travelers with cards that give free bags on specific airlines (e.g. Delta Gold) get lower effective cost
    traveler_profiles = {t: (user_repo.get_user_by_id(t) or {}) for t in travelers}
    benefit_airlines = build_benefit_airlines_for_travelers(traveler_profiles)
    if benefit_airlines and any(benefit_airlines.values()):
        logger.info("Card benefits for optimization: %s", {k: list(v) for k, v in benefit_airlines.items() if v})
    
    # Apply trip max_budget as cash constraint: per-traveler budget so total <= max_budget
    max_budget = trip.get("maxBudget") or trip.get("max_budget")
    try:
        max_budget = int(max_budget) if max_budget is not None else None
    except (TypeError, ValueError):
        max_budget = None
    default_cash_budget = (max_budget // len(travelers)) if (max_budget and len(travelers)) else 1e9

    # 7. Run ILP optimization using points maximization
    # plan_maximize_points_value (points_maximizer.py): maximizes cash saved by using points.
    # Objective: W1*points_value - W2*cash_paid - W3*time (W1=10^6, W2=10^3, W3=1; min 1 cpp).
    # When benefit_airlines is set, also adds W_benefit * bag_fee per passenger when payer's card gives free bags on that flight.
    relaxed_message: Optional[str] = None
    try:
        solution = run_ilp_from_edges(
            edges_all,
            travelers,
            start_city_by_trav,
            end_city_by_trav,
            user_points_by_trav,
            plan_maximize_points_value,  # Point optimization: max points value, min cash, min time
            meetup_cities=[],  # No meetup cities for now
            require_meetup_in_graph=False,
            must_visit_cities=city_codes,  # Each visited exactly once; optimizer chooses order to reduce cost
            transfer_graph=transfer_graph,
            transfer_bonuses={},
            bank_block_size=1000,
            allow_all_payers=True,
            default_cash_if_missing=1e7,
            default_time_if_missing=1e6,
            default_cash_budget=default_cash_budget,
            benefit_airlines=benefit_airlines,
        )
        
        status = solution.get("status", "Unknown")
        if status != "Optimal":
            if status == "Infeasible":
                relaxed_solution: Optional[Dict[str, Any]] = None
                # 1) Retry with relaxed budget (2x, 3x, 5x, 10x) when user had a real budget
                if max_budget is not None and max_budget > 0 and len(travelers) > 0:
                    for mult in [2, 3, 5, 10]:
                        try_budget = min(int(1e9), (max_budget * mult) // len(travelers))
                        if try_budget <= default_cash_budget:
                            continue
                        try:
                            sol_retry = run_ilp_from_edges(
                                edges_all,
                                travelers,
                                start_city_by_trav,
                                end_city_by_trav,
                                user_points_by_trav,
                                plan_maximize_points_value,
                                meetup_cities=[],
                                require_meetup_in_graph=False,
                                must_visit_cities=city_codes,
                                transfer_graph=transfer_graph,
                                transfer_bonuses={},
                                bank_block_size=1000,
                                allow_all_payers=True,
                                default_cash_if_missing=1e7,
                                default_time_if_missing=1e6,
                                default_cash_budget=try_budget,
                                benefit_airlines=benefit_airlines,
                            )
                            if sol_retry.get("status") == "Optimal" and any((sol_retry.get("path") or {}).values()):
                                relaxed_solution = sol_retry
                                tot = sol_retry.get("totals", {}).get("cash", 0) or 0
                                relaxed_message = (
                                    f"No feasible solution within your budget (${max_budget:,}). "
                                    f"We relaxed the budget and found a route including all your destinations. Total cash: ${tot:,.0f}. "
                                    "Consider increasing your budget or adding more points."
                                )
                                logger.info("Infeasible: found solution with relaxed budget %dx (try_budget=%s)", mult, try_budget)
                                break
                        except Exception as retry_err:
                            logger.debug("Relaxed budget retry (mult=%s) failed: %s", mult, retry_err)
                # 2) Best-effort: minimum cash path from graph (may exceed budget/points)
                if relaxed_solution is None:
                    relaxed_solution, relaxed_message = _best_effort_path_from_edges(
                        edges_all, start_city_by_trav, end_city_by_trav, travelers
                    )
                # 3) Use relaxed solution or fall back to AI route suggestions
                if relaxed_solution and any((relaxed_solution.get("path") or {}).values()):
                    solution = relaxed_solution
                    logger.info("Using relaxed/best-effort solution: %s", relaxed_message[:80] if relaxed_message else "")
                else:
                    logger.info(
                        "No feasible solution and no path in graph; returning AI route suggestions for %s -> %s",
                        start_dest_name or start_dest_code, end_dest_name or end_dest_code,
                    )
                    return _save_and_return_ai_route_suggestions(
                        trip_id,
                        start_dest_name or start_dest_code,
                        end_dest_name or end_dest_code,
                        cities,
                        start_date,
                        end_date,
                        failed_routes=failed_routes,
                        points_programs=list({p for u in user_points_by_trav.values() for p in u}),
                    )
            elif status == "Unbounded":
                logger.warning("Optimization is unbounded - this should not happen with proper constraints")
            else:
                logger.warning(f"ILP optimization status: {status}. Solution may not be optimal.")
        else:
            logger.info("ILP optimization completed successfully with optimal solution")
        
        # Validate solution has paths
        paths = solution.get("path", {})
        if not paths or not any(paths.values()):
            raise ValueError(
                "Optimization completed but no valid paths found. "
                "This may indicate no feasible routes exist between your destinations."
            )
            
    except ValueError:
        # Re-raise ValueError as-is (these are user-facing errors)
        raise
    except Exception as e:
        logger.error(f"Error running ILP optimization: {e}", exc_info=True)
        raise ValueError(f"Failed to optimize itinerary: {str(e)}. Please check your trip configuration.")
    
    # 8. Save itinerary
    # Convert solution to itinerary format
    itinerary_items = []
    
    # Totals (needed for path item costs); solution["totals"] is populated by the optimizer
    totals_for_path = solution.get("totals", {})
    
    # NOTE: Day allocation logic:
    # - Origin (path[0]) gets 0 days (departure only). Return-to-origin (path[-1]==path[0]) gets 0 days.
    # - Stays = cities in path[1:] that are in city_codes OR the end when it's a real destination (path[-1]!=path[0]).
    #   E.g. JFK→DOH→HKG with only HKG in city_codes: 9 days in HKG; Doha is transit (0 days).
    # - Days are split evenly among stay cities, with remainder to the last.
    # - To avoid splitting, only add destinations you actually want to stay in; connection cities will get 0 days.

    # Save paths for each traveler (include route, totalCost, pointsCost, name so frontend shows them as itineraries)
    total_days = _parse_trip_duration_days(trip)
    
    # User’s chosen destinations (city_codes, case-normalized). Transit/connection stops (e.g. Doha on JFK–DOH–HKG) are not in this set.
    _dest = set((c or "").upper() for c in (city_codes or []))
    logger.info(
        f"Allocating {total_days} days across destination cities: {list(_dest)}; start={start_dest_code}, end={end_dest_code}"
    )

    for traveler_id, path in solution.get("path", {}).items():
        if path:
            requested = set(_dest)
            # When the end is a real destination (not return-to-origin), include it so it gets stay days (e.g. JFK→DOH→HKG: 9 days in HKG).
            if len(path) >= 2 and (path[-1] or "").upper() != (path[0] or "").upper():
                requested.add((path[-1] or "").upper())
            # Stays = path nodes after origin that are in requested (path order). Transit stops are excluded.
            stays = [c for c in path[1:] if (c or "").upper() in requested]
            transit = [c for c in path[1:] if (c or "").upper() not in requested]
            if transit:
                logger.info(f"Route includes transit cities (0 days each): {transit}")

            if stays:
                num = len(stays)
                base = max(1, total_days // num)
                remainder = total_days - base * num
                day_list = [base] * num
                if remainder:
                    day_list[-1] += remainder
                city_objs = [{"name": c, "days": day_list[i]} for i, c in enumerate(stays)]
                logger.info(
                    f"Allocated days for traveler {traveler_id}: " + ", ".join([f"{c['name']}={c['days']}d" for c in city_objs])
                )
            else:
                city_objs = []
                logger.warning(f"No overnight stays allocated for traveler {traveler_id} (path={path})")
            item = {
                "tripId": trip_id,
                "itemId": f"path_{traveler_id}",
                "type": "path",
                "travelerId": traveler_id,
                "path": path,
                "route": path,  # full sequence for Route display (origin -> ... -> end)
                "cities": city_objs,  # stays only, with days (origin/return get 0 days)
                "totalCost": int(totals_for_path.get("cash") or 0),
                "pointsCost": int(totals_for_path.get("airline_points") or 0),
                "name": "Optimized route",
            }
            itinerary_items.append(item)
    
    # Save payment modes (add mode: flight|bus|car from edge[2] for frontend)
    for traveler_id, payments in solution.get("pay_mode", {}).items():
        if payments:
            enriched = []
            for rec in payments:
                r = dict(rec)
                edge = r.get("edge")
                fn = edge[2] if isinstance(edge, (list, tuple)) and len(edge) >= 3 else None
                r["mode"] = "bus" if fn == "BUS" else "car" if fn == "CAR" else "flight"
                enriched.append(r)
            item = {
                "tripId": trip_id,
                "itemId": f"payments_{traveler_id}",
                "type": "payments",
                "travelerId": traveler_id,
                "payments": enriched,
            }
            itinerary_items.append(item)
    
    # Save totals (enrich transfers with operating_carriers and segment_description for codeshare details)
    totals = dict(totals_for_path)
    totals["transfers"] = dict(totals.get("transfers") or {})
    for q, by_src in (totals_for_path.get("transfers") or {}).items():
        totals["transfers"][q] = dict(by_src or {})
        for s, by_al in (by_src or {}).items():
            totals["transfers"][q][s] = dict(by_al or {})
            for a, data in (by_al or {}).items():
                data = dict(data)
                edges_for_sa = []
                for _p, recs in (solution.get("pay_mode") or {}).items():
                    for rec in (recs or []):
                        if rec.get("type") != "points" or rec.get("payer") != q:
                            continue
                        v = rec.get("via") or {}
                        if (v.get("source") or "").lower().strip() != s or (v.get("airline") or "").upper().strip() != a:
                            continue
                        edge = rec.get("edge")
                        if isinstance(edge, (list, tuple)) and len(edge) >= 3:
                            edges_for_sa.append(tuple(edge))
                op_carriers = []
                for e in edges_for_sa:
                    if e in edges_all:
                        op = (edges_all[e].get("operating_airline") or "").strip().upper()
                        if op and len(op) >= 2 and op[:2] not in op_carriers:
                            op_carriers.append(op[:2])
                data["operating_carriers"] = op_carriers
                seg_desc = None
                if op_carriers:
                    diff = [c for c in op_carriers if c != a]
                    if diff:
                        names = [_HUMANIZE_AIRLINE.get(c) or c for c in diff]
                        seg_desc = " and ".join(names) + (" (codeshare)" if len(names) == 1 else " (codeshares)")
                data["segment_description"] = seg_desc
                totals["transfers"][q][s][a] = data
    totals_item = {
        "tripId": trip_id,
        "itemId": "totals",
        "type": "totals",
        "totals": totals,
    }
    itinerary_items.append(totals_item)
    
    # Save all items
    for item in itinerary_items:
        itinerary_repo.put_item(item)

    # Transfer strategy: AwardTool-driven (from solution pay_mode) or Panorama fallback; only use generic AI for the rest
    from src.handlers.openAI import get_itinerary_smart_tips

    aw_tips = build_transfer_tips_from_solution(solution, edges_all)
    if not aw_tips:
        user_banks = list({k for u in user_points_by_trav.values() for k in (u or {}) if isinstance(k, str) and (k or "").lower() in (DEFAULT_TRANSFER_GRAPH or {})})
        aw_tips = await _get_transfer_tips_from_panorama(
            origin=start_dest_code,
            destination=end_dest_code or start_dest_code,
            start_date=(start_date or "").strip(),
            end_date=(end_date or "").strip(),
            user_banks=user_banks,
        )

    points_programs = list({p for u in user_points_by_trav.values() for p in u})
    tips = get_itinerary_smart_tips(
        origin=start_dest_name or start_dest_code,
        destination=end_dest_name or end_dest_code,
        city_names=cities if cities else None,
        start_date=start_date or None,
        end_date=end_date or None,
        points_programs=points_programs if points_programs else None,
    )
    # Prefer AwardTool-derived transfer tips (exact amounts and partners) over generic AI
    if aw_tips:
        tips["transfer_tips"] = aw_tips

    tips_item = {
        "tripId": trip_id,
        "itemId": "itinerary_smart_tips",
        "type": "itinerary_smart_tips",
        "transfer_tips": tips.get("transfer_tips", []),
        "sample_itineraries": tips.get("sample_itineraries", []),
        "holiday_advice": tips.get("holiday_advice", []),
        "practical_tips": tips.get("practical_tips", []),
    }
    itinerary_repo.put_item(tips_item)
    itinerary_items.append(tips_item)

    # Out-of-pocket: persist and attach to response for simple A->B round-trips
    oop_payload: Optional[Dict[str, Any]] = None
    if oop_result and not oop_result.get("error"):
        oop_payload = {
            "best_by_cash": oop_result.get("best_by_cash"),
            "best_by_surcharge": oop_result.get("best_by_surcharge"),
            "best_overall": oop_result.get("best_overall"),
            "origin": oop_result.get("origin"),
            "destination": oop_result.get("destination"),
            "outbound_date": oop_result.get("outbound_date"),
            "return_date": oop_result.get("return_date"),
        }
        oop_item = {
            "tripId": trip_id,
            "itemId": "out_of_pocket",
            "type": "out_of_pocket",
            **oop_payload,
        }
        itinerary_repo.put_item(oop_item)
        itinerary_items.append(oop_item)

    # Hotel out-of-pocket: persist and attach for simple trips
    oop_hotels_payload: Optional[Dict[str, Any]] = None
    if oop_hotels_result and oop_hotels_result.get("options"):
        oop_hotels_payload = {
            "best_by_cash": oop_hotels_result.get("best_by_cash"),
            "best_by_points": oop_hotels_result.get("best_by_points"),
            "best_overall": oop_hotels_result.get("best_overall"),
            "destination": oop_hotels_result.get("destination"),
            "check_in": oop_hotels_result.get("check_in"),
            "check_out": oop_hotels_result.get("check_out"),
        }
        oop_h_item = {
            "tripId": trip_id,
            "itemId": "out_of_pocket_hotels",
            "type": "out_of_pocket_hotels",
            **oop_hotels_payload,
        }
        itinerary_repo.put_item(oop_h_item)
        itinerary_items.append(oop_h_item)

    # When we used relaxed budget or best-effort path, add an info item and flag the response
    if relaxed_message:
        relaxed_info = {
            "tripId": trip_id,
            "itemId": "itinerary_relaxed_info",
            "type": "itinerary_relaxed_info",
            "message": relaxed_message,
            "original_budget": max_budget,
            "suggested_cash": solution.get("totals", {}).get("cash"),
        }
        itinerary_repo.put_item(relaxed_info)
        itinerary_items.append(relaxed_info)

    out: Dict[str, Any] = {
        "status": solution.get("status", "Unknown"),
        "solution": solution,
        "items": itinerary_items,
        "out_of_pocket": oop_payload,
    }
    if oop_hotels_payload is not None:
        out["out_of_pocket_hotels"] = oop_hotels_payload
    if relaxed_message:
        out["relaxed_constraints"] = True
        out["relaxed_message"] = relaxed_message
    return out
