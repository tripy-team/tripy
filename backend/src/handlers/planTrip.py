from typing import List, Dict, Tuple, Set, Literal
import logging

try:
    import pulp as pl
except ModuleNotFoundError:
    pl = None

Edge = Tuple[str, str, str]
logger = logging.getLogger(__name__)

# =============================================================================
# HIGH SURCHARGE PROGRAMS - These should be penalized or avoided
# =============================================================================
HIGH_SURCHARGE_PROGRAMS: Set[str] = {"BA", "LH", "LX", "QF", "SQ", "VS", "KL", "AF"}
MAX_ACCEPTABLE_SURCHARGE = 200.0  # Surcharges above this get extra penalty

# Surcharge penalty weight - higher values more aggressively avoid high surcharges
SURCHARGE_PENALTY_WEIGHT = 100.0


def _calculate_surcharge_penalty(surcharge: float, airline: str) -> float:
    """
    Calculate additional penalty for high surcharges.
    Used to discourage selecting high-surcharge award options.
    """
    if surcharge <= 50:
        return 0.0
    
    # Base penalty for surcharges above $50
    base_penalty = max(0, surcharge - 50) * SURCHARGE_PENALTY_WEIGHT
    
    # Extra penalty for known high-surcharge programs
    if airline.upper() in HIGH_SURCHARGE_PROGRAMS:
        base_penalty *= 1.5
    
    # Extra penalty for surcharges above max acceptable
    if surcharge > MAX_ACCEPTABLE_SURCHARGE:
        base_penalty += (surcharge - MAX_ACCEPTABLE_SURCHARGE) * SURCHARGE_PENALTY_WEIGHT * 2
    
    return base_penalty


def plan_non_pooled_multi_itineraries_with_native(
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
    award_points: Dict[
        str, Dict[Edge, float]
    ],  # miles required if booked via airline a
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
    # Card benefits and other optional parameters
    benefit_airlines: List[str] = None,
    edge_to_airline: Dict[Edge, str] = None,
    bag_fee: float = 35.0,
    W_benefit: float = 1e4,
    must_visit_cities: List[str] = None,
    # Objective weights (points >> cash >> time)
    W1: float = 10**6,
    W2: float = 10**3,
    W3: float = 1.0,
    # NEW: Optimization mode - "oop" minimizes out-of-pocket, "cpp" maximizes CPP
    optimization_mode: Literal["oop", "cpp"] = "oop",
):
    """
    JSON-safe return structure (no tuple/list dict keys):
      {
        "status": ...,
        "path": {passenger: [city, ...]},
        "edges": {passenger: [[i,j,k], ...]},
        "pay_mode": {
          passenger: [
            {"edge":[i,j,k], "type":"cash", "payer": q, "fare": float} |
            {"edge":[i,j,k], "type":"points", "payer": q,
             "via":{"source": s, "airline": a} or {"native": a},
             "miles": float, "surcharge": float}
          ]
        },
        "totals": {
          "airline_points": float,
          "cash": float,
          "time": float,
          "transfers": {payer: {source: {airline: {"blocks": int,
                                                   "source_points": int,
                                                   "delivered_airline_points": float}}}},
          "native_used": {payer: {airline: float}}
        }
      }
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
        benefit_airlines = []
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
    for a in A:
        ap_map = award_points.get(a, {})
        aa_map = allowed_award_edge.get(a, {})
        for e in all_edges:
            miles = ap_map.get(e, None)
            if miles is None:
                safe_award[a][e] = 0.0  # not bookable / unspecified
                can_price[a][e] = 0
            else:
                safe_award[a][e] = float(miles)
                # if mask missing, infer: miles<INF -> bookable
                can_price[a][e] = int(aa_map.get(e, 1 if miles < INF else 0))
    allowed_award_edge = can_price

    safe_surcharge = {a: {} for a in A}
    for a in A:
        cs_map = cash_surcharge.get(a, {})
        for e in all_edges:
            safe_surcharge[a][e] = float(cs_map.get(e, 0.0))

    get_miles = lambda a, e: safe_award[a][e]  # 0.0 if not bookable/missing
    get_can = lambda a, e: allowed_award_edge[a][e]  # 0/1 mask
    get_tax = lambda a, e: safe_surcharge[a][e]  # 0.0 default

    # ---------------------------
    # MODEL
    # ---------------------------
    m = pl.LpProblem("NonPooledMultiItinsWithNative_yN", pl.LpMaximize)

    # Each PASSENGER chooses their own itinerary
    x = {p: pl.LpVariable.dicts(f"x_{p}", edges, 0, 1, cat="Binary") for p in T}

    # Payments
    z = {
        (q, p): pl.LpVariable.dicts(f"z_{q}_for_{p}", edges, 0, 1, cat="Binary")
        for q in T
        for p in T
    }
    y = {
        (q, p): {
            (s, a): pl.LpVariable.dicts(
                f"y_{q}_{s}_{a}_for_{p}", edges, 0, 1, cat="Binary"
            )
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T
        for p in T
    }
    # Native airline redemption variables (do not require a bank source)
    y_native = {
        (q, p): {
            a: pl.LpVariable.dicts(f"yN_{q}_{a}_for_{p}", edges, 0, 1, cat="Binary")
            for a in A
        }
        for q in T
        for p in T
    }

    # Transfer blocks per payer (source points)
    t_blocks = {
        q: {
            (s, a): pl.LpVariable(f"tb_{q}_{s}_{a}", lowBound=0, cat="Integer")
            for s in sources_by_trav.get(q, [])
            for a in A
            if (s, a) in allowed_sa
        }
        for q in T
    }

    # Native airline miles usage per payer (bounded by miles_balance)
    native_use = {
        q: {
            a: pl.LpVariable(f"native_use_{q}_{a}", lowBound=0.0, cat="Continuous")
            for a in A
        }
        for q in T
    }

    # MTZ + cumulative time per passenger
    u = {
        p: {
            c: pl.LpVariable(
                f"u_{p}_{c}", lowBound=1, upBound=len(cities), cat="Continuous"
            )
            for c in cities
        }
        for p in T
    }
    arr = {
        p: {
            c: pl.LpVariable(f"arr_{p}_{c}", lowBound=0.0, cat="Continuous")
            for c in cities
        }
        for p in T
    }

    # 1) Payment split: exactly one payer (cash or points) funds each chosen edge for each passenger
    for p in T:
        for e in edges:
            m += (
                pl.lpSum(z[(q, p)][e] for q in T)
                + pl.lpSum(
                    y[(q, p)][(s, a)][e] for q in T for (s, a) in y[(q, p)].keys()
                )
                + pl.lpSum(y_native[(q, p)][a][e] for q in T for a in A)
            ) == x[p][e]
            for q in T:
                # cash permission
                m += z[(q, p)][e] <= can_pay_for.get((q, p), 0)
                # bank-source points permissions
                for s, a in y[(q, p)].keys():
                    m += y[(q, p)][(s, a)][e] <= can_pay_for.get((q, p), 0)
                    m += y[(q, p)][(s, a)][e] <= link_ok.get((q, a), 0)
                    m += y[(q, p)][(s, a)][e] <= get_can(a, e)
                # native redemption permissions
                for a in A:
                    m += y_native[(q, p)][a][e] <= can_pay_for.get((q, p), 0)
                    m += y_native[(q, p)][a][e] <= link_ok.get((q, a), 0)
                    m += y_native[(q, p)][a][e] <= get_can(a, e)

    # 2) Flow constraints per passenger: start->end, other cities optional (pass-through)
    def in_deg(p, c):
        return pl.lpSum(x[p][e] for e in edges if e[1] == c)

    def out_deg(p, c):
        return pl.lpSum(x[p][e] for e in edges if e[0] == c)

    for p in T:
        s0, t0 = start_city[p], end_city[p]
        m += out_deg(p, s0) == 1
        m += in_deg(p, s0) == 0
        m += in_deg(p, t0) == 1
        m += out_deg(p, t0) == 0
        for c in cities:
            if c in (s0, t0):
                continue
            m += in_deg(p, c) == out_deg(p, c)  # optional pass-through

    # 3) Must-visit cities constraint
    for p in T:
        for city in must_visit_cities:
            if city != start_city[p] and city != end_city[p]:
                # Ensure passenger visits this city (at least one incoming edge)
                m += in_deg(p, city) >= 1
    
    # 4) MTZ subtour elimination per passenger
    city_pairs = {(i, j) for (i, j, _) in edges if i != j}
    x_any = {
        p: {
            (i, j): pl.lpSum(x[p][e] for e in edges if e[0] == i and e[1] == j)
            for (i, j) in city_pairs
        }
        for p in T
    }
    for p in T:
        m += u[p][start_city[p]] == 1
        for i in cities:
            if i == start_city[p]:
                continue
            for j in cities:
                if j == start_city[p] or i == j:
                    continue
                if (i, j) in x_any[p]:
                    m += u[p][i] - u[p][j] + 1 <= (len(cities) - 1) * (
                        1 - x_any[p][(i, j)]
                    )

    # 5) Cumulative arrival time propagation
    BIGM = 10**6
    for p in T:
        m += arr[p][start_city[p]] == 0.0
        for i, j, k in edges:
            m += arr[p][j] >= arr[p][i] + time_cost.get((i, j, k), 0.0) - BIGM * (
                1 - x[p][(i, j, k)]
            )

    # 6) Same-date meetups (optional)
    for c in meetup_cities:
        ref = T[0]
        for p in T[1:]:
            m += arr[p][c] == arr[ref][c]

    # 7) Transfers & balances per PAYER (including native miles)
    for q in T:
        # delivered from bank transfers for (s,a); may be augmented by native_use[q][a]
        for s, a in t_blocks[q].keys():
            delivered = (
                t_blocks[q][(s, a)] * inc_source[(s, a)] * ratio[(s, a)] * bonus[(s, a)]
            )
            used_via_q_a_from_sa = pl.lpSum(
                y[(q, p)][(s, a)][e] * get_miles(a, e) for p in T for e in edges
            )
            m += used_via_q_a_from_sa <= delivered + native_use[q][a]

        # pure native redemption draw (covers cases with no bank sources)
        for a in A:
            native_used_miles = pl.lpSum(
                y_native[(q, p)][a][e] * get_miles(a, e) for p in T for e in edges
            )
            m += native_used_miles <= native_use[q][a]

        # native miles caps by balance
        for a in A:
            m += native_use[q][a] <= float(miles_balance.get((q, a), 0.0))

        # source balance per payer (sum of transfers across airlines)
        for s in sources_by_trav.get(q, []):
            m += (
                pl.lpSum(
                    t_blocks[q][(s, a)] * inc_source[(s, a)]
                    for a in A
                    if (s, a) in t_blocks[q]
                )
                <= source_balances[(q, s)]
            )

        # cash budget per payer: fares + surcharges they personally incur
        cash_spend = pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0.0) for p in T for e in edges
        )
        sur_spend = pl.lpSum(
            # bank-source surcharges
            y[(q, p)][(s, a)][e] * get_tax(a, e)
            for (s, a) in t_blocks[q].keys()
            for p in T
            for e in edges
        ) + pl.lpSum(
            # native surcharges
            y_native[(q, p)][a][e] * get_tax(a, e)
            for a in A
            for p in T
            for e in edges
        )
        m += cash_spend + sur_spend <= budget_cash[q]

    # 8) Seat capacities (optional)
    for e in edges:
        cap = total_cash_seats.get(e, 10**9)
        if cap < 10**9:
            m += pl.lpSum(z[(q, p)][e] for q in T for p in T) <= cap
    for a in A:
        for e in edges:
            cap = award_seats.get(a, {}).get(e, 10**9)
            if cap < 10**9:
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

    # =================================================================
    # OBJECTIVE FUNCTION - Depends on optimization_mode
    # =================================================================
    # "oop" mode: Minimize out-of-pocket (cash + surcharges)
    # "cpp" mode: Maximize cents-per-point value (original behavior)
    
    def get_points_value(airline, edge):
        """Calculate points value: (cash_cost - surcharge) when using points"""
        miles = get_miles(airline, edge)
        if miles <= 0 or miles >= INF:
            return 0.0
        cash = cash_cost.get(edge, 0.0)
        sur = get_tax(airline, edge)
        if sur >= INF:
            sur = 0.0
        cash_saved = cash - sur
        return max(0.0, cash_saved)
    
    # Total cash paid when paying cash for flights
    cash_fares_expr = pl.lpSum(
        z[(q, p)][e] * cash_cost.get(e, 0.0) for q in T for p in T for e in edges
    )
    
    # Surcharges paid when using points (bank-source)
    bank_surcharges_expr = pl.lpSum(
        y[(q, p)][(s, a)][e] * get_tax(a, e)
        for q in T
        for p in T
        for (s, a) in y[(q, p)].keys()
        for e in edges
    )
    
    # Surcharges paid when using native miles
    native_surcharges_expr = pl.lpSum(
        y_native[(q, p)][a][e] * get_tax(a, e)
        for q in T
        for p in T
        for a in A
        for e in edges
    )
    
    # Total out-of-pocket = cash fares + all surcharges
    total_oop_expr = cash_fares_expr + bank_surcharges_expr + native_surcharges_expr
    
    # Total time
    total_time_expr = pl.lpSum(
        x[p][e] * time_cost.get(e, 0.0) for p in T for e in edges
    )
    
    # Surcharge penalty for high-surcharge programs (used in both modes)
    surcharge_penalty_expr = pl.lpSum(
        y[(q, p)][(s, a)][e] * _calculate_surcharge_penalty(get_tax(a, e), a)
        for q in T
        for p in T
        for (s, a) in y[(q, p)].keys()
        for e in edges
    ) + pl.lpSum(
        y_native[(q, p)][a][e] * _calculate_surcharge_penalty(get_tax(a, e), a)
        for q in T
        for p in T
        for a in A
        for e in edges
    )
    
    if optimization_mode == "oop":
        # =================================================================
        # OOP MODE: Minimize total out-of-pocket cost
        # =================================================================
        # Objective: Minimize (cash_paid + surcharges + surcharge_penalty + time)
        # 
        # This mode will use points even if CPP is "low" as long as it reduces
        # the total cash paid. It's more aggressive about using available points.
        #
        # Weights are adjusted to prioritize OOP reduction:
        # - High weight on OOP reduction (negative = minimize)
        # - Penalty for high surcharges to discourage bad redemptions
        # - Small time penalty as tiebreaker
        
        # Tiny bonus for using points to prefer points when OOP is equal
        points_usage_bonus = pl.lpSum(
            y[(q, p)][(s, a)][e] * 0.001
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * 0.001
            for q in T
            for p in T
            for a in A
            for e in edges
        )
        
        # Minimize: OOP + surcharge_penalty + time - points_bonus
        # (Maximize the negative of this)
        m += -W1 * total_oop_expr - surcharge_penalty_expr - W3 * total_time_expr + points_usage_bonus
        
        logger.info("Using OOP optimization mode: minimizing out-of-pocket costs")
    else:
        # =================================================================
        # CPP MODE: Maximize cents-per-point value (original behavior)
        # =================================================================
        # Points value = cash saved by using points
        points_value_expr = pl.lpSum(
            y[(q, p)][(s, a)][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
            for q in T
            for p in T
            for (s, a) in y[(q, p)].keys()
            for e in edges
            if get_points_value(a, e) > 0
        ) + pl.lpSum(
            y_native[(q, p)][a][e] * (cash_cost.get(e, 0.0) - get_tax(a, e))
            for q in T
            for p in T
            for a in A
            for e in edges
            if get_points_value(a, e) > 0
        )
        
        # Maximize: (points_value - cash_paid - time_penalty - surcharge_penalty)
        m += W1 * points_value_expr - W2 * total_oop_expr - W3 * total_time_expr - surcharge_penalty_expr
        
        logger.info("Using CPP optimization mode: maximizing cents-per-point value")

    # Solve
    m.solve(pl.PULP_CBC_CMD(msg=False))

    # ---------------------------
    # Extract (JSON-safe)
    # ---------------------------
    sol = {
        "status": pl.LpStatus[m.status],
        "path": {p: [] for p in T},
        "edges": {p: [] for p in T},  # edges as lists
        "pay_mode": {p: [] for p in T},  # list of payment records
        "totals": {
            "airline_points": 0.0,
            "cash": 0.0,  # Total out-of-pocket (cash fares + surcharges)
            "cash_fares": 0.0,  # Just cash fares (no points used)
            "surcharges": 0.0,  # Just surcharges from points redemptions
            "time": 0.0,
            "points_value": 0.0,  # Total cash value saved by using points
            "optimization_mode": optimization_mode,
            "transfers": {q: {} for q in T},  # transfers[q][source][airline] = {...}
            "native_used": {q: {} for q in T},  # native_used[q][airline] = miles
        },
    }
    if pl.LpStatus[m.status] != "Optimal":
        return sol

    # Paths per passenger
    for p in T:
        chosen = [e for e in edges if pl.value(x[p][e]) > 0.5]
        sol["edges"][p] = [[e[0], e[1], e[2]] for e in chosen]  # JSON-safe edges
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
    tot_cash_fares = 0.0  # Cash paid for flights (no points used)
    tot_surcharges = 0.0  # Surcharges on points redemptions
    tot_time = 0.0
    tot_points_value = 0.0
    tot_all_cash_would_be = 0.0  # What it would cost if paying all cash
    
    for p in T:
        for e in [tuple(edge) for edge in sol["edges"][p]]:  # back to tuple for lookups
            tot_time += time_cost.get(e, 0.0)
            tot_all_cash_would_be += cash_cost.get(e, 0.0)  # Track what cash would be
            paid = False
            # cash?
            for q in T:
                if pl.value(z[(q, p)][e]) > 0.5:
                    fare = float(cash_cost.get(e, 0.0))
                    tot_cash_fares += fare
                    sol["pay_mode"][p].append(
                        {
                            "edge": [e[0], e[1], e[2]],
                            "type": "cash",
                            "payer": q,
                            "fare": fare,
                        }
                    )
                    paid = True
                    break
                # bank-source points?
                for s, a in y[(q, p)].keys():
                    if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                        miles = float(get_miles(a, e))
                        sur = float(get_tax(a, e))
                        cash_val = float(cash_cost.get(e, 0.0))
                        points_value = max(0.0, cash_val - sur)
                        
                        tot_pts += miles
                        tot_surcharges += sur
                        tot_points_value += points_value
                        
                        sol["pay_mode"][p].append(
                            {
                                "edge": [e[0], e[1], e[2]],
                                "type": "points",
                                "payer": q,
                                "via": {"source": s, "airline": a},
                                "miles": miles,
                                "surcharge": sur,
                                "points_value": points_value,
                                "cents_per_point": (points_value * 100.0) / miles if miles > 0 else 0.0,
                                "cash_alternative": cash_val,  # What cash would have cost
                            }
                        )
                        paid = True
                        break
                if paid:
                    break
                # native points?
                for a in A:
                    if pl.value(y_native[(q, p)][a][e]) > 0.5:
                        miles = float(get_miles(a, e))
                        sur = float(get_tax(a, e))
                        cash_val = float(cash_cost.get(e, 0.0))
                        points_value = max(0.0, cash_val - sur)
                        
                        tot_pts += miles
                        tot_surcharges += sur
                        tot_points_value += points_value
                        
                        sol["pay_mode"][p].append(
                            {
                                "edge": [e[0], e[1], e[2]],
                                "type": "points",
                                "payer": q,
                                "via": {"native": a},
                                "miles": miles,
                                "surcharge": sur,
                                "points_value": points_value,
                                "cents_per_point": (points_value * 100.0) / miles if miles > 0 else 0.0,
                                "cash_alternative": cash_val,  # What cash would have cost
                            }
                        )
                        paid = True
                        break
                if paid:
                    break

    # Transfers & native usage (nested string-key dicts)
    for q in T:
        # transfers from bank sources
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
        # native usage caps reported
        for a in A:
            used = float(pl.value(native_use[q][a]) or 0.0)
            if used > 0:
                sol["totals"]["native_used"][q][a] = used

    # Calculate total out-of-pocket (cash fares + surcharges)
    total_oop = tot_cash_fares + tot_surcharges
    savings = tot_all_cash_would_be - total_oop
    savings_pct = (savings / tot_all_cash_would_be * 100) if tot_all_cash_would_be > 0 else 0.0
    
    sol["totals"]["airline_points"] = float(tot_pts)
    sol["totals"]["cash"] = float(total_oop)  # Total out-of-pocket
    sol["totals"]["cash_fares"] = float(tot_cash_fares)
    sol["totals"]["surcharges"] = float(tot_surcharges)
    sol["totals"]["time"] = float(tot_time)
    sol["totals"]["points_value"] = float(tot_points_value)
    sol["totals"]["all_cash_would_be"] = float(tot_all_cash_would_be)
    sol["totals"]["savings"] = float(savings)
    sol["totals"]["savings_percentage"] = round(savings_pct, 1)
    
    logger.info(
        f"Optimization complete (mode={optimization_mode}): "
        f"OOP=${total_oop:.2f}, All-cash=${tot_all_cash_would_be:.2f}, "
        f"Savings=${savings:.2f} ({savings_pct:.1f}%), Points={tot_pts:.0f}"
    )
    
    return sol
