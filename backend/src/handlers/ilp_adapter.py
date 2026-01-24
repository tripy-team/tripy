# backend/ilp_adapter.py  (edges -> ILP inputs; user-selected meetup cities)
from src.utils.card_benefits import build_edge_to_airline


def _is_bank_key(k, transfer_graph):
    return (
        isinstance(k, str)
        and k.islower()
        and (transfer_graph is None or k in transfer_graph)
    )


def _as_airline_code(k):
    return str(k or "").strip().upper()


def _split_balances_for_trav(user_points_one, transfer_graph):
    banks, airlines = {}, {}
    for k, v in (user_points_one or {}).items():
        if _is_bank_key(k, transfer_graph):
            banks[str(k).lower()] = float(v or 0)
        else:
            al = _as_airline_code(k)
            if al:
                airlines[al] = airlines.get(al, 0.0) + float(v or 0)
    return banks, airlines


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
    for e, d in edges_dict.items():
        tval = d.get("time_cost")
        cval = d.get("cash_cost")
        time_cost[e] = (
            float(tval) if tval is not None else float(default_time_if_missing)
        )
        cash_cost[e] = (
            float(cval) if cval is not None else float(default_cash_if_missing)
        )

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
    benefit_airlines=None,
    bag_fee=35.0,
    W_benefit=1e4,
    **adapter_kwargs,
):
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
    )
