"""
Points Maximization Algorithm

This module provides optimization functions to maximize the value of travel points
by selecting itineraries that provide the best redemption rates (cents per point).
"""

from typing import List, Dict, Tuple, Set

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

Edge = Tuple[str, str, str]


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
):
    """
    Optimize itinerary to maximize points value (cash saved per point used).
    
    Objective: Maximize (cash_value_of_points_redemption - actual_cash_paid - time_penalty)
    
    Points value = (cash_cost - cash_surcharge) when using points
    This represents the cash value saved by using points instead of paying cash.
    
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

    T = travelers
    A = airlines
    INF = 10**9

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
            if miles is None:
                safe_award[a][e] = 0.0
                can_price[a][e] = 0
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
            if i == start_city[p]:
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    - pl.lpSum(x[p][e] for e in edges if e[1] == i)
                    == 1
                )
            elif i == end_city[p]:
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    - pl.lpSum(x[p][e] for e in edges if e[1] == i)
                    == -1
                )
            else:
                m += (
                    pl.lpSum(x[p][e] for e in edges if e[0] == i)
                    == pl.lpSum(x[p][e] for e in edges if e[1] == i)
                )

    # 1b) Must-visit: each city in must_visit_cities is visited exactly once (optimizer chooses order to reduce cost)
    for c in must_visit_cities:
        for p in T:
            if c == start_city.get(p) or c == end_city.get(p):
                continue
            m += pl.lpSum(x[p][e] for e in edges if e[1] == c) == 1

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
    # OBJECTIVE: Maximize Points Value
    # ---------------------------
    # Points value = cash saved by using points instead of paying cash
    # For each edge paid with points: value = (cash_cost - surcharge)
    # We want to maximize total points value while minimizing actual cash paid
    
    points_value_expr = pl.lpSum(
        y[(q, p)][(s, a)][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
        for q in T
        for p in T
        for (s, a) in y[(q, p)].keys()
        for e in edges
        if get_points_value(a, e) >= min_points_value_cpp  # Only use if value >= threshold
    ) + pl.lpSum(
        y_native[(q, p)][a][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
        for q in T
        for p in T
        for a in A
        for e in edges
        if get_points_value(a, e) >= min_points_value_cpp  # Only use if value >= threshold
    )
    
    # Actual cash paid (cash bookings + surcharges on points bookings)
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

    # Maximize: (points_value - cash_paid - time_penalty) + card benefit savings
    # This prioritizes using points where they have high value and favor payers whose cards reduce bag fees
    m += W1 * points_value_expr - W2 * total_cash_expr - W3 * total_time_expr + W_benefit * benefit_expr

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
    
    if pl.LpStatus[m.status] != "Optimal":
        return sol

    # Paths per passenger
    for p in T:
        chosen = [e for e in edges if pl.value(x[p][e]) > 0.5]
        sol["edges"][p] = [[e[0], e[1], e[2]] for e in chosen]
        nxt = {}
        for i, j, k in chosen:
            nxt[i] = j
        cur = start_city[p]
        path = [cur]
        while cur in nxt and cur != end_city[p]:
            cur = nxt[cur]
            path.append(cur)
        sol["path"][p] = path

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
                    paid = True
                    break
                
                # Check bank-source points
                for s, a in y[(q, p)].keys():
                    if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                        miles = float(get_miles(a, e))
                        sur = float(get_tax(a, e))
                        cash_val = float(cash_cost.get(e, 0.0))
                        points_value = cash_val - sur
                        
                        tot_pts += miles
                        tot_cash_val += sur
                        tot_points_value += points_value
                        
                        sol["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"source": s, "airline": a},
                            "miles": miles,
                            "surcharge": sur,
                            "points_value": points_value,
                            "cents_per_point": (points_value * 100.0) / miles if miles > 0 else 0.0,
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
                        points_value = cash_val - sur
                        
                        tot_pts += miles
                        tot_cash_val += sur
                        tot_points_value += points_value
                        
                        sol["pay_mode"][p].append({
                            "edge": [e[0], e[1], e[2]],
                            "type": "points",
                            "payer": q,
                            "via": {"native": a},
                            "miles": miles,
                            "surcharge": sur,
                            "points_value": points_value,
                            "cents_per_point": (points_value * 100.0) / miles if miles > 0 else 0.0,
                        })
                        paid = True
                        break
                if paid:
                    break

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
    
    return sol
