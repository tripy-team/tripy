# ----------------------------
# Minimal example incl. Traveler C with native UA miles
# ----------------------------
import pulp as pl
from typing import Dict, List, Tuple, Set
from planTrip import plan_non_pooled_multi_itineraries_with_native

Edge = Tuple[str, str, str]  # (origin, dest, flight_id)


def test():
    travelers = ["A", "B", "C"]
    start_city = {"A": "SEA", "B": "SFO", "C": "LAX"}
    end_city = {"A": "AMS", "B": "AMS", "C": "AMS"}
    cities = ["SEA", "SFO", "LAX", "JFK", "CDG", "AMS"]

    edges: List[Edge] = [
        ("SEA", "JFK", "UA123"),
        ("SEA", "JFK", "DL456"),
        ("SFO", "JFK", "UA789"),
        ("LAX", "JFK", "UA345"),
        ("JFK", "CDG", "AF020"),
        ("JFK", "CDG", "DL020"),
        ("CDG", "AMS", "AF030"),
        ("CDG", "AMS", "KL030"),
    ]

    time_cost = {
        ("SEA", "JFK", "UA123"): 5.7,
        ("SEA", "JFK", "DL456"): 5.5,
        ("SFO", "JFK", "UA789"): 5.2,
        ("LAX", "JFK", "UA345"): 5.1,
        ("JFK", "CDG", "AF020"): 7.0,
        ("JFK", "CDG", "DL020"): 7.3,
        ("CDG", "AMS", "AF030"): 1.2,
        ("CDG", "AMS", "KL030"): 1.3,
    }
    cash_cost = {
        ("SEA", "JFK", "UA123"): 320,
        ("SEA", "JFK", "DL456"): 300,
        ("SFO", "JFK", "UA789"): 280,
        ("LAX", "JFK", "UA345"): 310,
        ("JFK", "CDG", "AF020"): 200,
        ("JFK", "CDG", "DL020"): 190,
        ("CDG", "AMS", "AF030"): 90,
        ("CDG", "AMS", "KL030"): 95,
    }

    airlines = ["UA", "AF", "DL", "KL"]
    INF = 10**9
    award_points = {
        "UA": {
            ("SEA", "JFK", "UA123"): 15000,
            ("SFO", "JFK", "UA789"): 13000,
            ("LAX", "JFK", "UA345"): 14000,
        },
        "AF": {
            ("JFK", "CDG", "AF020"): 20000,
            ("CDG", "AMS", "AF030"): 8000,
        },
        "DL": {
            ("SEA", "JFK", "DL456"): 15500,
            ("JFK", "CDG", "DL020"): 24000,
        },
        "KL": {("CDG", "AMS", "KL030"): 9000},
    }
    cash_surcharge = {
        "UA": {
            ("SEA", "JFK", "UA123"): 5.6,
            ("SFO", "JFK", "UA789"): 5.6,
            ("LAX", "JFK", "UA345"): 5.6,
        },
        "AF": {("JFK", "CDG", "AF020"): 60.0, ("CDG", "AMS", "AF030"): 25.0},
        "DL": {("SEA", "JFK", "DL456"): 6.0, ("JFK", "CDG", "DL020"): 70.0},
        "KL": {("CDG", "AMS", "KL030"): 28.0},
    }
    allowed_award_edge = {
        "UA": {
            ("SEA", "JFK", "UA123"): 1,
            ("SFO", "JFK", "UA789"): 1,
            ("LAX", "JFK", "UA345"): 1,
        },
        "AF": {("JFK", "CDG", "AF020"): 1, ("CDG", "AMS", "AF030"): 1},
        "DL": {("SEA", "JFK", "DL456"): 1, ("JFK", "CDG", "DL020"): 1},
        "KL": {("CDG", "AMS", "KL030"): 1},
    }

    # Sources & balances (bank points)
    sources_by_trav = {"A": ["UR", "MR"], "B": ["UR"], "C": []}  # C has NO bank sources
    source_balances = {("A", "UR"): 40000, ("A", "MR"): 60000, ("B", "UR"): 25000}

    allowed_sa = {("UR", "UA"), ("UR", "DL"), ("MR", "AF"), ("MR", "KL")}
    ratio = {("UR", "UA"): 1.0, ("UR", "DL"): 1.0, ("MR", "AF"): 1.0, ("MR", "KL"): 1.0}
    bonus = {
        ("UR", "UA"): 1.0,
        ("UR", "DL"): 1.0,
        ("MR", "AF"): 1.25,
        ("MR", "KL"): 1.0,
    }
    inc_source = {
        ("UR", "UA"): 1000,
        ("UR", "DL"): 1000,
        ("MR", "AF"): 1000,
        ("MR", "KL"): 1000,
    }

    # NEW: Traveler C has 25,000 UA miles (native), but no bank points
    miles_balance = {("C", "UA"): 250000}

    # Eligibility (payer must own the airline account)
    link_ok = {
        ("A", "UA"): 1,
        ("A", "AF"): 1,
        ("A", "DL"): 1,
        ("A", "KL"): 1,
        ("B", "UA"): 1,
        ("B", "AF"): 0,
        ("B", "DL"): 1,
        ("B", "KL"): 1,
        ("C", "UA"): 1,
        ("C", "AF"): 0,
        ("C", "DL"): 0,
        ("C", "KL"): 0,
    }

    budget_cash = {"A": 800.0, "B": 600.0, "C": 400.0}

    # Who can pay for whom
    can_pay_for = {
        ("A", "A"): 1,
        ("A", "B"): 1,
        ("A", "C"): 1,
        ("B", "A"): 0,
        ("B", "B"): 1,
        ("B", "C"): 0,
        ("C", "A"): 1,
        ("C", "B"): 1,
        ("C", "C"): 1,
    }

    # Optional capacities (omit or set big if unknown)
    total_cash_seats = {}
    award_seats = {}

    meetup_cities = ["JFK", "CDG"]  # force same-date arrivals at JFK & CDG

    sol = plan_non_pooled_multi_itineraries_with_native(
        travelers,
        start_city,
        end_city,
        cities,
        edges,
        time_cost,
        cash_cost,
        airlines,
        award_points,
        cash_surcharge,
        allowed_award_edge,
        sources_by_trav,
        source_balances,
        allowed_sa,
        ratio,
        bonus,
        inc_source,
        miles_balance,
        link_ok,
        budget_cash,
        can_pay_for,
        total_cash_seats,
        award_seats,
        meetup_cities,
        W1=10**6,
        W2=10**3,
        W3=1.0,
    )

    from pprint import pprint

    pprint(sol)
    return sol


if __name__ == "__main__":
    test()
