"""
Points Maximization Algorithm

This module provides optimization functions to maximize the value of travel points
by selecting itineraries that provide the best redemption rates (cents per point).

UPDATED: Now supports two optimization modes:
- "cpp" (default): Maximize cents-per-point value (original behavior)
- "oop": Minimize out-of-pocket costs (prioritizes reducing cash paid)

ENHANCED with OOP Reduction Strategies:
- Program-specific CPP thresholds (higher for premium programs, lower for domestic)
- Surcharge-aware optimization (penalizes high-surcharge awards)
- Surcharge caps (rejects awards where surcharge > 50% of cash price)
"""

from typing import List, Dict, Tuple, Set, Literal, Optional

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

# Import OOP optimization utilities
try:
    from src.utils.award_programs import get_cpp_threshold, is_high_surcharge_program
except ImportError:
    # Fallback if import fails
    def get_cpp_threshold(program: str) -> float:
        return 1.0
    def is_high_surcharge_program(program: str) -> bool:
        return program.upper() in {"BA", "LH", "LX", "QF", "SQ", "VS"}

# Import HUB_CITIES from optimization constants
try:
    from src.optimization.constants import HUB_CITIES
except ImportError:
    # Fallback: define hub cities inline if import fails
    HUB_CITIES = {
        # Middle East
        'IST', 'DOH', 'DXB', 'AUH', 'BAH', 'AMM', 'JED', 'RUH',
        # Europe
        'CDG', 'LHR', 'FRA', 'AMS', 'ZRH', 'MUC', 'VIE', 'MAD', 'FCO', 'LIS', 'WAW', 'HEL', 'CPH', 'ARN',
        # US
        'JFK', 'EWR', 'LAX', 'ORD', 'DFW', 'MIA', 'ATL', 'IAH', 'SFO', 'SEA', 'BOS', 'IAD', 'CLT', 'PHL', 'DEN', 'PHX',
        # Canada
        'YYZ', 'YVR', 'YUL',
        # Asia
        'SIN', 'HKG', 'ICN', 'NRT', 'HND', 'PEK', 'PVG', 'BKK', 'KUL', 'DEL', 'BOM', 'TPE', 'MNL',
        # Africa
        'JNB', 'ADD', 'NBO', 'CAI', 'CMN',
        # South America
        'GRU', 'EZE', 'BOG', 'SCL', 'LIM', 'PTY',
        # Oceania
        'SYD', 'MEL', 'AKL',
    }

Edge = Tuple[str, str, str]

# Optimization mode type
# - "cpp_focused": Only use points when cpp > 1.0 (above market value / cash-out rate)
# - "money_saving": Use points whenever cpp > 0 (any positive savings, prioritize cash reduction)
# - "balanced": Optimize cpp adjusted by travel time and number of stops
# - "cpp" / "oop": Legacy modes (cpp = cpp_focused, oop = money_saving)
OptimizationMode = Literal["cpp", "oop", "cpp_focused", "money_saving", "balanced"]

# =============================================================================
# OOP REDUCTION CONFIGURATION
# =============================================================================

# Maximum surcharge as percentage of cash price (awards above this are rejected)
MAX_SURCHARGE_CASH_RATIO = 0.50  # 50% of cash price

# Maximum absolute surcharge per segment
MAX_SURCHARGE_PER_SEGMENT = 300.0  # $300

# Weight for surcharge penalty in OOP mode
SURCHARGE_PENALTY_WEIGHT = 50.0

# Minimum CPP for awards in OOP mode (lower than CPP mode since OOP prioritizes cash savings)
MIN_CPP_OOP_MODE = 0.5


def plan_maximize_points_value(
    # Travelers and routing
    travelers: List[str],
    start_city: Dict[str, str],
    end_city: Dict[str, str],
    cities: List[str],
    edges: List[Edge],
    time_cost: Dict[Edge, float],
    cash_cost: Dict[Edge, float],
    # Airline programs & award pricing
    airlines: List[str],
    award_points: Dict[str, Dict[Edge, float]],  # miles required if booked via airline a
    cash_surcharge: Dict[str, Dict[Edge, float]],  # taxes/YQ by airline per flight
    allowed_award_edge: Dict[str, Dict[Edge, int]],  # 1 if airline a can price edge e
    # Sources & balances PER PAYER (no pooling of bank points)
    sources_by_trav: Dict[str, List[str]],  # {payer: [sources]}
    source_balances: Dict[Tuple[str, str], float],  # {(payer, source): points}
    # Transfer rules (global)
    allowed_sa: Set[Tuple[str, str]],  # {(source, airline)}
    ratio: Dict[Tuple[str, str], float],  # miles per source point
    bonus: Dict[Tuple[str, str], float],  # promo multiplier
    inc_source: Dict[Tuple[str, str], int],  # transfer block size (e.g., 1000)
    # Native airline balances (use miles directly without transfer)
    miles_balance: Dict[Tuple[str, str], float],  # {(payer, airline): miles}
    # Eligibility & budgets
    link_ok: Dict[Tuple[str, str], int],  # {(payer, airline): 0/1}
    budget_cash: Dict[str, float],  # {payer: $}
    # Who is allowed to pay for whom (cash or points)
    can_pay_for: Dict[Tuple[str, str], int],  # {(payer, passenger): 0/1}
    # Seat capacities (optional; set large / leave empty if unknown)
    total_cash_seats: Dict[Edge, int] = None,
    award_seats: Dict[str, Dict[Edge, int]] = None,
    # Meetup synchronization (optional exact same-date arrival)
    meetup_cities: List[str] = None,
    # Objective weights (points_value >> cash >> time)
    W1: float = 10**6,  # Weight for points value (cash saved by using points)
    W2: float = 10**3,  # Weight for cash cost
    W3: float = 1.0,  # Weight for time
    # Minimum points value threshold (cents per point) - only use points if value >= threshold
    min_points_value_cpp: float = 1.0,  # Minimum 1 cent per point
    # Card benefits: when payer has a card with free bags on the edge's airline, add bag_fee to the objective per passenger paid
    *,
    benefit_airlines: Dict[str, Set[str]] = None,  # {payer: set of IATA codes}
    edge_to_airline: Dict[Edge, str] = None,  # edge -> IATA
    bag_fee: float = 35.0,
    W_benefit: float = 1e4,
    must_visit_cities: List[str] = None,  # intermediates that must be visited exactly once; optimizer chooses order
    # NEW: Optimization mode - "cpp" (cents per point) or "oop" (out of pocket)
    optimization_mode: OptimizationMode = "oop",  # Default to OOP (minimize cash)
    # Datetime strings for chronological ordering (format: "YYYY-MM-DDTHH:MM:SS" or "YYYY-MM-DD HH:MM")
    departure_time: Dict[Edge, str] = None,  # {edge: departure_datetime_string}
    arrival_time: Dict[Edge, str] = None,    # {edge: arrival_datetime_string}
):
    """
    Optimize itinerary for flights.
    
    Supports two optimization modes:
    
    - "cpp" (Cents Per Point): Maximize points value, only use points if CPP >= threshold
      Objective: Maximize (cash_value_of_points_redemption - actual_cash_paid - time_penalty)
      
    - "oop" (Out Of Pocket): Minimize total cash paid, use points whenever they reduce cash
      Objective: Minimize (total_cash_paid + surcharges - time_bonus)
      This mode prioritizes reducing out-of-pocket costs over getting "good CPP value"
    
    Returns same structure as plan_non_pooled_multi_itineraries_with_native
    """
    if pl is None:
        raise ImportError("pulp package is not installed. Install it with: pip install pulp")

    if total_cash_seats is None:
        total_cash_seats = {}
    if award_seats is None:
        award_seats = {}
    if meetup_cities is None:
        meetup_cities = []
    if must_visit_cities is None:
        must_visit_cities = []
    if benefit_airlines is None:
        benefit_airlines = {}
    if edge_to_airline is None:
        edge_to_airline = {}
    if departure_time is None:
        departure_time = {}
    if arrival_time is None:
        arrival_time = {}

    T = travelers
    A = airlines
    INF = 10**9
    
    # ---------------------------
    # PARSE DATETIME STRINGS FOR CHRONOLOGICAL ORDERING
    # ---------------------------
    from datetime import datetime as dt
    
    def parse_datetime(s):
        """Parse datetime string to timestamp (minutes since epoch for comparison)."""
        if not s:
            return None
        try:
            # Try ISO format: "2026-02-17T14:30:00"
            if "T" in s:
                parsed = dt.strptime(s.split(".")[0], "%Y-%m-%dT%H:%M:%S")
            elif " " in s:
                # Try space format: "2026-02-17 14:30"
                try:
                    parsed = dt.strptime(s, "%Y-%m-%d %H:%M:%S")
                except ValueError:
                    parsed = dt.strptime(s, "%Y-%m-%d %H:%M")
            else:
                return None
            # Return minutes since a reference point (for easier ILP math)
            return (parsed - dt(2020, 1, 1)).total_seconds() / 60.0
        except (ValueError, AttributeError):
            return None
    
    edge_departure_minutes = {}
    edge_arrival_minutes = {}
    for e in edges:
        dep = parse_datetime(departure_time.get(e))
        arr = parse_datetime(arrival_time.get(e))
        if dep is not None:
            edge_departure_minutes[e] = dep
        if arr is not None:
            edge_arrival_minutes[e] = arr
    
    import logging
    logger = logging.getLogger(__name__)
    logger.info(f"ILP datetime parsing: {len(edge_departure_minutes)} edges with departure times, {len(edge_arrival_minutes)} edges with arrival times out of {len(edges)} total edges")
    
    # Log graph structure for debugging
    edges_by_od = {}
    for e in edges:
        od = (e[0], e[1])
        edges_by_od[od] = edges_by_od.get(od, 0) + 1
    logger.info(f"ILP graph structure: {dict(edges_by_od)}")

    # ---------------------------
    # NORMALIZATION (safe lookups)
    # ---------------------------
    all_edges = list(edges)
    safe_award = {a: {} for a in A}
    can_price = {a: {} for a in A}
    safe_surcharge = {a: {} for a in A}
    
    for a in A:
        ap_map = award_points.get(a, {})
        aa_map = allowed_award_edge.get(a, {})
        sur_map = cash_surcharge.get(a, {})
        for e in all_edges:
            miles = ap_map.get(e, None)
            # IMPORTANT: Treat missing miles OR zero/tiny miles as ineligible
            # Zero miles means no award pricing exists, not a "free" flight
            if miles is None or (isinstance(miles, (int, float)) and float(miles) <= 0):
                safe_award[a][e] = 0.0
                can_price[a][e] = 0  # Block this airline from pricing this edge
                safe_surcharge[a][e] = INF
            else:
                safe_award[a][e] = float(miles)
                safe_surcharge[a][e] = float(sur_map.get(e, 0.0))
                can_price[a][e] = aa_map.get(e, 1) if aa_map.get(e, 1) else 1

    def get_miles(airline, edge):
        return safe_award[airline].get(edge, INF)

    def get_tax(airline, edge):
        return safe_surcharge[airline].get(edge, INF)

    def get_points_value(airline, edge):
        """Calculate points value: (cash_cost - surcharge) / points_cost in cents per point"""
        miles = get_miles(airline, edge)
        if miles <= 0 or miles >= INF:
            return 0.0
        cash = cash_cost.get(edge, 0.0)
        sur = get_tax(airline, edge)
        if sur >= INF:
            sur = 0.0
        cash_saved = cash - sur
        if cash_saved <= 0:
            return 0.0
        # Return cents per point
        return (cash_saved * 100.0) / miles

    def should_reject_award(airline, edge) -> bool:
        """
        Determine if an award should be rejected due to excessive surcharges.
        Used to filter out awards where paying cash would be more economical.
        """
        sur = get_tax(airline, edge)
        if sur >= INF:
            return True
        cash = cash_cost.get(edge, 0.0)
        if cash <= 0:
            return False
        # Reject if surcharge > MAX_SURCHARGE_CASH_RATIO of cash price
        if sur > cash * MAX_SURCHARGE_CASH_RATIO:
            return True
        # Reject if surcharge > MAX_SURCHARGE_PER_SEGMENT
        if sur > MAX_SURCHARGE_PER_SEGMENT:
            return True
        return False

    def get_program_cpp_threshold(airline) -> float:
        """Get program-specific CPP threshold."""
        return get_cpp_threshold(airline)

    def calculate_surcharge_penalty(airline, edge) -> float:
        """
        Calculate penalty for high surcharges in OOP mode.
        Higher penalty for high-surcharge programs.
        """
        sur = get_tax(airline, edge)
        if sur >= INF or sur <= 50:
            return 0.0
        base_penalty = max(0, sur - 50) * SURCHARGE_PENALTY_WEIGHT
        # Extra penalty for high-surcharge programs
        if is_high_surcharge_program(airline):
            base_penalty *= 1.5
        return base_penalty

    # ---------------------------
    # MODEL
    # ---------------------------
    m = pl.LpProblem("MaximizePointsValue", pl.LpMaximize)

    # Decision variables (same structure as original)
    x = {p: {e: pl.LpVariable(f"x_{p}_{e}", cat="Binary") for e in edges} for p in T}
    z = {
        (q, p): {
            e: pl.LpVariable(f"z_{q}_{p}_{e}", cat="Binary")
            for e in edges
        }
        for q in T
        for p in T
    }
    y = {
        (q, p): {
            (s, a): {
                e: pl.LpVariable(f"y_{q}_{p}_{s}_{a}_{e}", cat="Binary")
                for e in edges
            }
            for (s, a) in [
                (s, a) for s in sources_by_trav.get(q, []) for a in A if (s, a) in allowed_sa
            ]
        }
        for q in T
        for p in T
    }
    y_native = {
        (q, p): {
            a: {e: pl.LpVariable(f"yn_{q}_{p}_{a}_{e}", cat="Binary") for e in edges}
            for a in A
        }
        for q in T
        for p in T
    }
    
    # Transfer blocks
    t_blocks = {
        q: {
            (s, a): pl.LpVariable(
                f"t_{q}_{s}_{a}", lowBound=0, cat="Integer"
            )
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T
    }

    # ---------------------------
    # DEBUG LOGGING: Points availability
    # ---------------------------
    # Log what points sources are available
    all_sources = set()
    for q in T:
        srcs = sources_by_trav.get(q, [])
        all_sources.update(srcs)
        logger.info(f"ILP traveler {q}: bank sources={srcs}")
    
    # Log miles balances (native airline points)
    native_balances = {k: v for k, v in miles_balance.items() if v > 0}
    if native_balances:
        logger.info(f"ILP native airline miles: {native_balances}")
    else:
        logger.info("ILP native airline miles: NONE")
    
    # Log source balances (transferable points)
    source_bals = {k: v for k, v in source_balances.items() if v > 0}
    if source_bals:
        logger.info(f"ILP transferable points: {source_bals}")
    else:
        logger.info("ILP transferable points: NONE")
    
    # Log airlines available in the graph
    logger.info(f"ILP airlines in graph: {A}")
    
    # Log link_ok status (which traveler-airline pairs can use points)
    linked = [(t, a) for (t, a), ok in link_ok.items() if ok]
    not_linked = [(t, a) for (t, a), ok in link_ok.items() if not ok]
    logger.info(f"ILP points linked (link_ok=1): {len(linked)} pairs")
    logger.info(f"ILP points NOT linked (link_ok=0): {len(not_linked)} pairs")
    if not linked:
        logger.warning("ILP WARNING: No traveler-airline pairs have link_ok=1. Points cannot be used!")
    
    # Log which edges have award pricing
    award_edges = 0
    award_by_route = {}  # Track award availability by O-D pair
    for a in A:
        for e in edges:
            if can_price[a].get(e, 0) > 0 and safe_award[a].get(e, 0) > 0:
                award_edges += 1
                route_key = (e[0], e[1])
                if route_key not in award_by_route:
                    award_by_route[route_key] = []
                award_by_route[route_key].append((a, int(safe_award[a][e]), int(safe_surcharge[a].get(e, 0))))
    logger.info(f"ILP edges with award pricing: {award_edges} (airlines={len(A)}, edges={len(edges)})")
    
    # Log award options for each O-D pair (sample first 3 per route)
    for route, options in sorted(award_by_route.items()):
        if len(options) > 0:
            sample = sorted(options, key=lambda x: x[1])[:3]  # Top 3 by miles
            logger.debug(f"ILP award options {route[0]}->{route[1]}: {sample} (total={len(options)} options)")
    
    # DEBUG: Log specifically for ICN→JFK edges
    icn_jfk_edges = [e for e in edges if e[0] == 'ICN' and e[1] == 'JFK']
    logger.info(f"ILP DEBUG: ICN->JFK edges found: {len(icn_jfk_edges)}")
    for e in icn_jfk_edges:
        cash = cash_cost.get(e, 0)
        award_info = []
        for a in A:
            miles = safe_award[a].get(e, 0)
            can = can_price[a].get(e, 0)
            sur = safe_surcharge[a].get(e, 0)
            if miles > 0 or can > 0:
                award_info.append(f"{a}:{miles}mi,${int(sur)},can={can}")
        logger.info(f"ILP DEBUG: Edge {e[2]}: cash=${cash:.0f}, awards=[{', '.join(award_info) if award_info else 'NONE'}]")
    
    # ---------------------------
    # CONSTRAINTS (same as original)
    # ---------------------------
    BIGM = 10**6

    # 1) Path constraints
    for p in T:
        # Must start at start_city[p]
        m += pl.lpSum(x[p][e] for e in edges if e[0] == start_city[p]) == 1
        # Must end at end_city[p]
        m += pl.lpSum(x[p][e] for e in edges if e[1] == end_city[p]) == 1
        # Flow conservation
        for i in cities:
            if i == start_city[p] and i == end_city[p]:
                # Round trip: start and end at same city
                # Flow conservation: outflow == inflow (one out, one in)
                # The line 279/281 constraints already ensure exactly 1 out and 1 in
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    == pl.lpSum(x[p][e] for e in edges if e[1] == i)
                )
            elif i == start_city[p]:
                # One-way trip: net outflow of 1 from start
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    - pl.lpSum(x[p][e] for e in edges if e[1] == i)
                    == 1
                )
            elif i == end_city[p]:
                # One-way trip: net inflow of 1 to end
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    - pl.lpSum(x[p][e] for e in edges if e[1] == i)
                    == -1
                )
            else:
                # Transit city: flow conservation (in == out)
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    == pl.lpSum(x[p][e] for e in edges if e[1] == i)
                )

    # 1b) Must-visit: each city in must_visit_cities is visited AT LEAST once
    # Note: For multi-city trips (JFK→AUH→DXB→JFK), each destination must be visited
    for c in must_visit_cities:
        for p in T:
            if c == start_city.get(p) or c == end_city.get(p):
                continue
            m += pl.lpSum(x[p][e] for e in edges if e[1] == c) >= 1
    
    # 1b2) Sub-tour prevention using chronological ordering
    # ========================================================
    # We rely on CHRONOLOGICAL ORDERING to prevent sub-tours and ensure valid paths.
    # This is simpler and more robust than edge-based sequence variables.
    #
    # Key insight: For a valid itinerary, flights must be in chronological order.
    # The chronological constraints (below) ensure:
    # - Connections have sufficient time (60+ minutes)
    # - Return flights depart after outbound flights arrive
    # - No "time travel" violations
    #
    # Combined with flow conservation, this naturally prevents sub-tours because:
    # - Flow conservation ensures a connected path
    # - Chronological ordering ensures proper time sequence
    # - Start/end constraints ensure the path begins and ends correctly
    #
    # We do NOT need edge-based sequence variables because:
    # 1. They can cause infeasibility with round trips (conflicting constraints at start city)
    # 2. Chronological ordering already handles the sequencing
    # 3. Flow conservation already prevents disconnected components
    
    # Build adjacency maps for chronological constraint checking
    edges_arriving_at_map = {}
    edges_departing_from_map = {}
    for e in edges:
        origin, dest, _ = e
        edges_departing_from_map.setdefault(origin, []).append(e)
        edges_arriving_at_map.setdefault(dest, []).append(e)
    
    logger.info(f"ILP sub-tour prevention: using chronological ordering (no edge sequence variables)")
    
    # 1c) Chronological ordering: ensure flights are in proper time sequence
    # For CONSECUTIVE edges, enforce that the second must depart after the first arrives
    # 
    # IMPORTANT: For round trips (start == end), we must NOT apply this constraint
    # at the start city between return arrivals and outbound departures!
    # - Outbound: JFK → DXB (departs Feb 25)
    # - Return: DXB → JFK (arrives Mar 17)
    # The outbound departs BEFORE the return arrives, but they're NOT consecutive -
    # they're at opposite ends of the trip.
    #
    # The constraint "if dep(e2) < arr(e1), can't select both" would incorrectly
    # block selecting both the outbound and return for a round trip!
    if edge_departure_minutes and edge_arrival_minutes:
        chrono_constraints_added = 0
        chrono_skipped_at_start = 0
        MIN_CONNECTION_TIME = 60  # Minimum 60 minutes for connections
        
        for p in T:
            start = start_city.get(p)
            end = end_city.get(p)
            is_round_trip = (start == end)
            
            for city in cities:
                # For each pair of (arriving edge, departing edge) at this city
                for e1 in edges_arriving_at_map.get(city, []):
                    arr1 = edge_arrival_minutes.get(e1)
                    if arr1 is None:
                        continue
                    for e2 in edges_departing_from_map.get(city, []):
                        dep2 = edge_departure_minutes.get(e2)
                        if dep2 is None:
                            continue
                        
                        # SKIP constraint at start city for round trips:
                        # - e1 arriving at start = return flight
                        # - e2 departing from start = outbound flight
                        # These are NOT consecutive - outbound is first, return is last
                        if is_round_trip and city == start:
                            chrono_skipped_at_start += 1
                            continue
                        
                        # For consecutive edges: if departure < arrival + min_connection, block
                        if dep2 < arr1 + MIN_CONNECTION_TIME:
                            m += x[p][e1] + x[p][e2] <= 1
                            chrono_constraints_added += 1
        
        logger.info(f"ILP chronological constraints: {chrono_constraints_added} invalid time pairs blocked, {chrono_skipped_at_start} skipped at start city (min connection: {MIN_CONNECTION_TIME}min)")

    # 2) Payment constraints: exactly one payer (cash or points) per chosen edge
    for p in T:
        for e in edges:
            m += (
                pl.lpSum(z[(q, p)][e] for q in T)
                + pl.lpSum(
                    y[(q, p)][(s, a)][e]
                    for q in T
                    for (s, a) in y[(q, p)].keys()
                )
                + pl.lpSum(y_native[(q, p)][a][e] for q in T for a in A)
                == x[p][e]
            )

    # 2b) can_pay_for: restrict which payer q can pay for passenger p
    for p in T:
        for e in edges:
            for q in T:
                m += z[(q, p)][e] <= can_pay_for.get((q, p), 0)
                for (s, a) in y[(q, p)].keys():
                    m += y[(q, p)][(s, a)][e] <= can_pay_for.get((q, p), 0)
                for a in A:
                    m += y_native[(q, p)][a][e] <= can_pay_for.get((q, p), 0)

    # 3) Transfer constraints
    for q in T:
        for s in sources_by_trav.get(q, []):
            for a in A:
                if (s, a) not in allowed_sa:
                    continue
                blk_size = inc_source.get((s, a), 1000)
                delivered_per_block = blk_size * ratio.get((s, a), 1.0) * bonus.get((s, a), 1.0)
                m += (
                    pl.lpSum(
                        y[(q, p)][(s, a)][e] * get_miles(a, e)
                        for p in T
                        for e in edges
                        if (s, a) in y[(q, p)].keys()
                    )
                    <= t_blocks[q][(s, a)] * delivered_per_block
                )
                m += (
                    t_blocks[q][(s, a)] * blk_size
                    <= source_balances.get((q, s), 0.0)
                )

    # 4) Native points constraints
    for q in T:
        for a in A:
            m += (
                pl.lpSum(
                    y_native[(q, p)][a][e] * get_miles(a, e) for p in T for e in edges
                )
                <= miles_balance.get((q, a), 0.0)
            )

    # 5) Eligibility constraints (link_ok: payer–airline; can_price: airline can price edge)
    for q in T:
        for p in T:
            for e in edges:
                for (s, a) in y[(q, p)].keys():
                    m += y[(q, p)][(s, a)][e] <= link_ok.get((q, a), 0) * can_price[a].get(e, 0)
                for a in A:
                    m += y_native[(q, p)][a][e] <= link_ok.get((q, a), 0) * can_price[a].get(e, 0)

    # 6) Cash budget constraints
    for q in T:
        cash_spend = pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0.0) for p in T for e in edges
        )
        sur_spend = pl.lpSum(
            y[(q, p)][(s, a)][e] * get_tax(a, e)
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * get_tax(a, e)
            for p in T
            for a in A
            for e in edges
        )
        m += cash_spend + sur_spend <= budget_cash[q]

    # 7) Seat capacities
    for e in edges:
        cap = total_cash_seats.get(e, INF)
        if cap < INF:
            m += pl.lpSum(z[(q, p)][e] for q in T for p in T) <= cap
    for a in A:
        for e in edges:
            cap = award_seats.get(a, {}).get(e, INF)
            if cap < INF:
                m += (
                    pl.lpSum(
                        y[(q, p)][(s, a)][e]
                        for q in T
                        for p in T
                        for (s, aa) in y[(q, p)].keys()
                        if aa == a
                    )
                    + pl.lpSum(y_native[(q, p)][a][e] for q in T for p in T)
                ) <= cap

    # ---------------------------
    # OBJECTIVE: Based on optimization_mode
    # ---------------------------
    
    # Actual cash paid (cash bookings + surcharges on points bookings)
    # Used in both modes
    total_cash_expr = (
        pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0.0) for q in T for p in T for e in edges
        )
        + pl.lpSum(
            y[(q, p)][(s, a)][e] * get_tax(a, e)
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
        )
        + pl.lpSum(
            y_native[(q, p)][a][e] * get_tax(a, e)
            for q in T
            for p in T
            for a in A
            for e in edges
        )
    )
    
    total_time_expr = pl.lpSum(
        x[p][e] * time_cost.get(e, 0.0) for p in T for e in edges
    )

    # Card benefits: when payer q has free bags on the edge's airline, add bag_fee per passenger q pays for on e
    benefit_expr = pl.lpSum(
        bag_fee
        * (
            pl.lpSum(z[(q, p)][e] for p in T)
            + pl.lpSum(
                y[(q, p)][(s, a)][e]
                for p in T
                for (s, a) in y[(q, p)].keys()
            )
            + pl.lpSum(y_native[(q, p)][a][e] for p in T for a in A)
        )
        for q in T
        for e in edges
        if edge_to_airline.get(e) in benefit_airlines.get(q, set())
    )

    # ---------------------------
    # EXTRA CITY PENALTY: Discourage routes through intermediate cities
    # ---------------------------
    # User wants direct routes (e.g., JFK->DXB->JFK), not routes through extra cities
    # (e.g., JFK->DXB->BAH->JFK). Add a significant penalty for edges that arrive at
    # cities not in the user's destination list.
    
    wanted_cities = set()
    for p in T:
        wanted_cities.add(start_city[p])
        wanted_cities.add(end_city[p])
    wanted_cities.update(must_visit_cities or [])
    
    # ---------------------------
    # BALANCED RANKING SYSTEM
    # ---------------------------
    # The ranking considers three factors:
    # 1. Cost (cash + points value) - lower is better
    # 2. Total travel time - lower is better
    # 3. Number of connections - lower is better
    #
    # For legitimate connections (e.g., JFK→BAH→AUH), we don't heavily penalize
    # the transit city, but we do penalize extra flight segments.
    
    # Count connections: each additional segment beyond the minimum adds penalty
    # For a trip with N must-visit cities (including start/end), minimum segments = N
    # Example: JFK→DXB→JFK has 2 destinations, minimum 2 segments
    min_segments = len(must_visit_cities) + 1 if must_visit_cities else 2  # At least outbound + return
    num_edges_expr = pl.lpSum(x[p][e] for p in T for e in edges)
    extra_connections_expr = num_edges_expr - min_segments  # Connections beyond minimum
    
    # Penalize routing through cities that are NOT:
    # - Start/end cities
    # - Must-visit destinations
    # - Recognized hub cities (common connection points)
    # HUB_CITIES is imported from src.optimization.constants
    
    # Only penalize edges to non-hub, non-wanted cities
    non_hub_cities = set(cities) - wanted_cities - HUB_CITIES
    extra_city_penalty_expr = pl.lpSum(
        x[p][e] for p in T for e in edges if e[1] in non_hub_cities
    )
    
    # ---------------------------
    # WEIGHT CONFIGURATION FOR BALANCED RANKING
    # ---------------------------
    # These weights create a balance between cost, time, and connections
    # 
    # Ranking Formula (conceptually):
    #   Score = Cost_Score + Time_Score + Connection_Score
    #   where each component is normalized and weighted
    
    # Base weights (can be tuned)
    # Connection penalties are EXTREMELY HIGH to strongly prefer direct/1-stop routes
    # This essentially makes extra connections prohibitive unless absolutely necessary
    W_connection = 10**12   # Penalty per extra connection (EXTREME - almost prohibitive)
    W_extra_city = 10**13   # Penalty for non-hub transit cities (even higher)
    W_time_base = 10**3     # Base penalty for travel time

    # ==========================================================================
    # COMMON HELPER EXPRESSIONS
    # ==========================================================================
    MAX_REALISTIC_CASH = 10000  # Cap savings to avoid fallback value inflation
    
    def capped_savings(e, a):
        """Calculate points savings, capped to avoid inflated fallback values."""
        cash = cash_cost.get(e, 0.0)
        if cash > MAX_REALISTIC_CASH:
            cash = MAX_REALISTIC_CASH  # Cap unrealistic values
        return max(0, cash - get_tax(a, e))
    
    # Surcharge penalty expression - penalize high surcharges when using points
    surcharge_penalty_expr = pl.lpSum(
        y[(q, p)][(s, a)][e] * calculate_surcharge_penalty(a, e)
        for q in T
        for p in T
        for (s, a) in y[(q, p)].keys()
        for e in edges
    ) + pl.lpSum(
        y_native[(q, p)][a][e] * calculate_surcharge_penalty(a, e)
        for q in T
        for p in T
        for a in A
        for e in edges
    )
    
    # Transfer penalty: minimize unnecessary point transfers
    transfer_penalty_expr = pl.lpSum(
        t_blocks[q][(s, a)]
        for q in T
        for s, a in t_blocks[q].keys()
    )
    
    # ==========================================================================
    # MODE SELECTION: Choose optimization strategy
    # ==========================================================================
    # Map legacy modes to new modes
    effective_mode = optimization_mode
    if optimization_mode == "oop":
        effective_mode = "money_saving"  # Legacy OOP = Money Saving
    elif optimization_mode == "cpp":
        effective_mode = "cpp_focused"   # Legacy CPP = CPP Focused
    
    logger.info(f"ILP optimization mode: {optimization_mode} (effective: {effective_mode})")
    
    if effective_mode == "money_saving":
        # ==========================================================================
        # MONEY SAVING MODE: MINIMIZE TOTAL OUT-OF-POCKET COST
        # ==========================================================================
        # Goal: Find the CHEAPEST route (cash + surcharges), preferring fewer connections
        # Strategy: 
        #   1. MINIMIZE total cash spent (primary goal)
        #   2. MINIMIZE number of connections (strong secondary goal)
        #   3. Use points when they reduce cash (but don't chase points)
        #
        # KEY INSIGHT: We don't REWARD points usage - we simply allow points
        # to REPLACE cash when cheaper. The objective minimizes cost, not maximizes points.
        #
        # total_cash_expr (defined above) = cash bookings + award surcharges
        # This is the TRUE out-of-pocket cost.
        
        # Weights: MINIMIZE cost and connections
        # The objective is: minimize(cost + connections penalty + time penalty)
        W_cost = 10**10         # PRIMARY: Minimize out-of-pocket cost ($1 = 10^10 penalty)
        W_conn = 10**12         # CRITICAL: Each extra connection = $100 equivalent penalty
        W_time = 10**3          # MODERATE: Prefer shorter flights
        W_surcharge = 10**8     # HIGH: Penalize high surcharges  
        W_transfer = 10**2      # LOW: Minor penalty for transfers
        
        # PuLP maximizes by default, so we negate everything we want to minimize
        # Lower cost = better, fewer connections = better, shorter time = better
        m += (- W_cost * total_cash_expr           # Minimize cash spent
              - W_surcharge * surcharge_penalty_expr  # Minimize surcharges
              - W_conn * extra_connections_expr    # HEAVILY penalize extra connections
              - W_time * total_time_expr           # Prefer shorter routes
              + W_benefit * benefit_expr           # Card benefits bonus
              - W_extra_city * extra_city_penalty_expr  # Penalize non-hub cities
              - W_transfer * transfer_penalty_expr)    # Minor transfer penalty
        
    elif effective_mode == "cpp_focused":
        # ==========================================================================
        # CPP FOCUSED MODE: Only use points when cpp > 1.0 (above market value)
        # ==========================================================================
        # Goal: Maximize the value extracted from points (good redemption rates)
        # Strategy: Only use points if getting > 1 cent per point (market value)
        # Rejects: cpp <= 1.0 (below market / cash-out rate)
        
        MIN_CPP_FOCUSED = 1.0  # Must be above market value (1 cent per point)
        
        # Points value: Only count if cpp > 1.0 (above market value)
        points_value_expr = pl.lpSum(
            y[(q, p)][(s, a)][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
            if (get_points_value(a, e) > MIN_CPP_FOCUSED and  # Must be ABOVE 1.0 cpp
                not should_reject_award(a, e))
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
            for q in T
            for p in T
            for a in A
            for e in edges
            if (get_points_value(a, e) > MIN_CPP_FOCUSED and
                not should_reject_award(a, e))
        )
        
        # Weights: Prioritize point value over cash savings
        W_value = 10**7         # HIGH reward for good CPP redemptions
        W_cash = 10**4          # Moderate penalty for cash (but value matters more)
        W_surcharge = 10**5     # HIGH penalty for surcharges (they hurt CPP)
        W_time = 10**3          # Moderate time penalty
        W_transfer = 10         # Small transfer penalty
        
        m += (W_value * points_value_expr 
              - W_cash * total_cash_expr 
              - W_surcharge * surcharge_penalty_expr
              - W_time * total_time_expr 
              + W_benefit * benefit_expr
              - W_extra_city * extra_city_penalty_expr
              - W_connection * extra_connections_expr
              - W_transfer * transfer_penalty_expr)
        
    elif effective_mode == "balanced":
        # ==========================================================================
        # BALANCED MODE: Optimize cpp adjusted by travel time and stops
        # ==========================================================================
        # Goal: Find optimal balance between points value, travel time, and convenience
        # Strategy: Score = CPP_value / (hours_traveled * (1 + stops))
        # This creates a "value per hour per stop" metric
        
        MIN_CPP_BALANCED = 0.5  # Accept moderate CPP
        
        # Calculate adjusted value: cpp * time_factor * connection_factor
        # time_factor = 1 / max(1, hours/10)  -- shorter flights get bonus
        # connection_factor = 1 / (1 + stops) -- fewer stops get bonus
        
        def balanced_value(e, a):
            """Calculate balanced value: savings adjusted by time and connections."""
            cash = cash_cost.get(e, 0.0)
            if cash > MAX_REALISTIC_CASH:
                cash = MAX_REALISTIC_CASH
            savings = max(0, cash - get_tax(a, e))
            
            # Time adjustment: shorter flights get bonus (normalized by 10 hours)
            time_mins = time_cost.get(e, 600)  # Default 10 hours
            time_hours = max(1, time_mins / 60)
            time_factor = 10.0 / time_hours  # Shorter = higher factor
            
            return savings * min(time_factor, 3.0)  # Cap time bonus at 3x
        
        # Points value with balanced scoring
        balanced_value_expr = pl.lpSum(
            y[(q, p)][(s, a)][e] * balanced_value(e, a)
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
            if (get_points_value(a, e) >= MIN_CPP_BALANCED and
                not should_reject_award(a, e))
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * balanced_value(e, a)
            for q in T
            for p in T
            for a in A
            for e in edges
            if (get_points_value(a, e) >= MIN_CPP_BALANCED and
                not should_reject_award(a, e))
        )
        
        # Weights: Balance all factors
        W_balanced = 10**6      # Balanced value reward
        W_cash = 10**5          # Moderate cash penalty
        W_surcharge = 10**4     # Moderate surcharge penalty
        W_time = 10**4          # SIGNIFICANT time penalty (part of balanced scoring)
        W_transfer = 5          # Moderate transfer penalty
        W_conn_balanced = 10**8 # HIGH connection penalty (fewer stops = better)
        
        m += (W_balanced * balanced_value_expr 
              - W_cash * total_cash_expr 
              - W_surcharge * surcharge_penalty_expr
              - W_time * total_time_expr 
              + W_benefit * benefit_expr
              - W_extra_city * extra_city_penalty_expr
              - W_conn_balanced * extra_connections_expr
              - W_transfer * transfer_penalty_expr)
        
    else:
        # ==========================================================================
        # FALLBACK: Default to balanced mode if unknown mode specified
        # ==========================================================================
        logger.warning(f"Unknown optimization mode '{optimization_mode}', defaulting to balanced")
        
        MIN_CPP_FALLBACK = 0.5
        
        # Points savings with moderate threshold
        points_savings_fallback = pl.lpSum(
            y[(q, p)][(s, a)][e] * capped_savings(e, a)
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
            if (cash_cost.get(e, 0.0) > get_tax(a, e) and
                get_points_value(a, e) >= MIN_CPP_FALLBACK and
                not should_reject_award(a, e))
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * capped_savings(e, a)
            for q in T
            for p in T
            for a in A
            for e in edges
            if (cash_cost.get(e, 0.0) > get_tax(a, e) and
                get_points_value(a, e) >= MIN_CPP_FALLBACK and
                not should_reject_award(a, e))
        )
        
        m += (10**6 * points_savings_fallback 
              - 10**5 * total_cash_expr 
              - 10**3 * total_time_expr 
              + W_benefit * benefit_expr 
              - W_extra_city * extra_city_penalty_expr
              - W_connection * extra_connections_expr
              - transfer_penalty_expr)

    # Solve
    m.solve(pl.PULP_CBC_CMD(msg=False))

    # ---------------------------
    # Extract solution (same as original)
    # ---------------------------
    sol = {
        "status": pl.LpStatus[m.status],
        "path": {p: [] for p in T},
        "edges": {p: [] for p in T},
        "pay_mode": {p: [] for p in T},
        "totals": {
            "airline_points": 0.0,
            "cash": 0.0,
            "time": 0.0,
            "points_value": 0.0,  # Total cash value saved by using points
            "transfers": {q: {} for q in T},
            "native_used": {q: {} for q in T},
        },
    }
    
    solver_status = pl.LpStatus[m.status]
    logger.info(f"ILP solver status: {solver_status} (mode={optimization_mode}, edges={len(edges)}, cities={cities}, start={list(start_city.values())}, end={list(end_city.values())}, must_visit={must_visit_cities})")
    
    if solver_status != "Optimal":
        # Log more details about why it might be infeasible
        logger.warning(f"ILP solver returned {solver_status} - checking constraint feasibility...")
        
        # Debug: check if basic graph connectivity exists
        has_outgoing = {c: False for c in cities}
        has_incoming = {c: False for c in cities}
        for e in edges:
            has_outgoing[e[0]] = True
            has_incoming[e[1]] = True
        
        for p in T:
            start = start_city[p]
            end = end_city[p]
            if not has_outgoing.get(start, False):
                logger.error(f"No outgoing edges from start city {start}!")
            if not has_incoming.get(end, False):
                logger.error(f"No incoming edges to end city {end}!")
            for c in (must_visit_cities or []):
                if not has_incoming.get(c, False):
                    logger.error(f"No incoming edges to must-visit city {c}!")
                if not has_outgoing.get(c, False):
                    logger.error(f"No outgoing edges from must-visit city {c}!")
        
        return sol

    # Paths per passenger
    for p in T:
        chosen = [e for e in edges if pl.value(x[p][e]) > 0.5]
        sol["edges"][p] = [[e[0], e[1], e[2]] for e in chosen]
        
        # Build adjacency map (handle potential multiple edges from same city)
        nxt = {}
        for i, j, k in chosen:
            if i in nxt:
                # Multiple edges from same city - log warning but keep first one
                logger.warning(f"ILP path extraction: multiple edges from {i}: {nxt[i]} and {j} - keeping first")
            else:
                nxt[i] = j
        
        cur = start_city[p]
        path = [cur]
        visited = {cur}  # Track visited cities to prevent infinite loops
        
        # Build path by following edges until we reach end_city (works for both one-way and round trips)
        # For round trips (start==end), we traverse the cycle back to start
        max_iterations = len(cities) + 5  # Safety limit
        iterations = 0
        while cur in nxt and iterations < max_iterations:
            iterations += 1
            next_city = nxt[cur]
            path.append(next_city)
            
            if next_city == end_city[p]:
                break  # Reached destination (or returned to start for round trips)
            
            if next_city in visited and next_city != end_city[p]:
                logger.warning(f"ILP path extraction: cycle detected at {next_city}, breaking")
                break
            
            visited.add(next_city)
            cur = next_city
        
        # Validate path includes must-visit cities
        path_set = set(path)
        for mv in (must_visit_cities or []):
            if mv not in path_set:
                logger.error(f"ILP path for {p} missing must-visit city {mv}! Path: {path}, chosen edges: {len(chosen)}")
        
        sol["path"][p] = path
        logger.info(f"ILP path for traveler {p}: {path} (edges={len(chosen)})")

    # Payments & totals
    tot_pts = 0.0
    tot_cash_val = 0.0
    tot_time = 0.0
    tot_points_value = 0.0
    
    for p in T:
        for e in [tuple(edge) for edge in sol["edges"][p]]:
            tot_time += time_cost.get(e, 0.0)
            paid = False
            
            # Check cash payment
            for q in T:
                if pl.value(z[(q, p)][e]) > 0.5:
                    fare = float(cash_cost.get(e, 0.0))
                    tot_cash_val += fare
                    sol["pay_mode"][p].append({
                        "edge": [e[0], e[1], e[2]],
                        "type": "cash",
                        "payer": q,
                        "fare": fare,
                    })
                    # Debug: Log why cash was chosen for this edge
                    award_opts = []
                    for a in A:
                        if can_price[a].get(e, 0) > 0 and safe_award[a].get(e, 0) > 0:
                            award_opts.append((a, int(safe_award[a][e]), int(safe_surcharge[a].get(e, 0))))
                    if award_opts:
                        logger.info(f"ILP chose CASH ${fare:.0f} for {e[0]}->{e[1]} ({e[2]}) over award options: {sorted(award_opts, key=lambda x: x[1])[:5]}")
                    else:
                        # Check if OTHER flights on this route have award options
                        route_award_opts = []
                        for other_e in edges:
                            if other_e[0] == e[0] and other_e[1] == e[1] and other_e != e:
                                for a in A:
                                    if can_price[a].get(other_e, 0) > 0 and safe_award[a].get(other_e, 0) > 0:
                                        route_award_opts.append((other_e[2], a, int(safe_award[a][other_e]), int(safe_surcharge[a].get(other_e, 0)), int(cash_cost.get(other_e, 0))))
                        if route_award_opts:
                            logger.info(f"ILP chose CASH ${fare:.0f} for {e[0]}->{e[1]} ({e[2]}) - NO award for THIS flight, but OTHER {e[0]}->{e[1]} flights have awards: {sorted(route_award_opts, key=lambda x: x[2])[:5]}")
                        else:
                            logger.info(f"ILP chose CASH ${fare:.0f} for {e[0]}->{e[1]} ({e[2]}) - NO award options for ANY flight on this route")
                    paid = True
                    break
                
                # Check bank-source points
                for s, a in y[(q, p)].keys():
                    if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                        miles = float(get_miles(a, e))
                        sur = float(get_tax(a, e))
                        cash_val = float(cash_cost.get(e, 0.0))
                        
                        # Only calculate points_value if cash_cost is a real value (not fallback)
                        # Fallback is 1e7, so any value > 100000 is likely fallback
                        if cash_val > 100000:
                            # Estimate points value using standard 1.5 cents per point
                            points_value = miles * 0.015
                        else:
                            points_value = max(0, cash_val - sur)
                        
                        tot_pts += miles
                        tot_cash_val += sur
                        tot_points_value += points_value
                        
                        cpp = (points_value * 100.0) / miles if miles > 0 else 0.0
                        sol["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"source": s, "airline": a},
                            "miles": miles,
                            "surcharge": sur,
                            "points_value": points_value,
                            "cents_per_point": cpp,
                        })
                        paid = True
                        break
                if paid:
                    break
                
                # Check native points
                for a in A:
                    if pl.value(y_native[(q, p)][a][e]) > 0.5:
                        miles = float(get_miles(a, e))
                        sur = float(get_tax(a, e))
                        cash_val = float(cash_cost.get(e, 0.0))
                        
                        # Only calculate points_value if cash_cost is a real value (not fallback)
                        if cash_val > 100000:
                            points_value = miles * 0.015
                        else:
                            points_value = max(0, cash_val - sur)
                        
                        tot_pts += miles
                        tot_cash_val += sur
                        tot_points_value += points_value
                        
                        cpp = (points_value * 100.0) / miles if miles > 0 else 0.0
                        sol["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"native": a},
                            "miles": miles,
                            "surcharge": sur,
                            "points_value": points_value,
                            "cents_per_point": cpp,
                        })
                        paid = True
                        break
                if paid:
                    break

    # Log payment summary
    cash_payments = [pm for p in T for pm in sol["pay_mode"][p] if pm.get("type") == "cash"]
    points_payments = [pm for p in T for pm in sol["pay_mode"][p] if pm.get("type") == "points"]
    logger.info(f"ILP payment summary: cash={len(cash_payments)}, points={len(points_payments)}, total_cash=${tot_cash_val:.0f}, points_used={tot_pts:.0f}, points_value=${tot_points_value:.0f}")
    if cash_payments:
        logger.info(f"ILP cash payments: {[(pm['edge'], pm['fare']) for pm in cash_payments]}")
    if points_payments:
        logger.info(f"ILP points payments: {[(pm['edge'], pm.get('via'), pm['miles']) for pm in points_payments]}")

    # Transfers & native usage
    for q in T:
        for s, a in t_blocks[q].keys():
            blocks = int(round(pl.value(t_blocks[q][(s, a)]) or 0))
            if blocks > 0:
                sp = int(blocks * inc_source[(s, a)])
                delivered = float(sp * ratio[(s, a)] * bonus[(s, a)])
                sol["totals"]["transfers"].setdefault(q, {}).setdefault(s, {})[a] = {
                    "blocks": blocks,
                    "source_points": sp,
                    "delivered_airline_points": delivered,
                }
        for a in A:
            used = float(pl.value(pl.lpSum(
                y_native[(q, p)][a][e] * get_miles(a, e)
                for p in T
                for e in edges
            )) or 0.0)
            if used > 0:
                sol["totals"]["native_used"][q][a] = used

    sol["totals"]["airline_points"] = float(tot_pts)
    sol["totals"]["cash"] = float(tot_cash_val)
    sol["totals"]["time"] = float(tot_time)
    sol["totals"]["points_value"] = float(tot_points_value)
    sol["totals"]["optimization_mode"] = effective_mode  # Track which strategy was used
    
    # Log optimization summary
    logger.info(f"ILP optimization complete ({effective_mode}): {tot_pts:.0f} points, ${tot_cash_val:.0f} cash, ${tot_points_value:.0f} points value")
    
    return sol
