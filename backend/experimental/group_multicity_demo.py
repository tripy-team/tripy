# examples/group_multicity_demo.py
from backend.domain.optimize.flights import get_flights_award_first_with_points
from backend.domain.optimize.ilp_adapter import run_ilp_from_edges
from planTrip import plan_non_pooled_multi_itineraries_with_native

travelers = ["alice", "bob", "carol"]
start_city = {"alice": "SEA", "bob": "JFK", "carol": "SFO"}
end_city = {"alice": "CDG", "bob": "CDG", "carol": "FCO"}

# Let the user choose meetup(s); empty list => no enforced meetup
user_meetups = ["CDG"]

filters_alice = {
    "outbound_date": "2026-02-11",
    "travel_class": "economy",
    "stops": 1,
    "bags": 1,
    "pax": 1,
    "award_programs": ["AF", "KL", "DL", "BA", "AA", "AS", "UA", "VS", "AC", "TK"],
}
filters_bob = {
    "outbound_date": "2026-02-13",
    "travel_class": "economy",
    "stops": 1,
    "bags": 1,
    "pax": 1,
    "award_programs": ["AF", "KL", "DL", "BA", "AA", "AS", "UA", "VS", "AC", "TK"],
}
filters_carol = {
    "outbound_date": "2026-02-12",
    "travel_class": "economy",
    "stops": 1,
    "bags": 1,
    "pax": 1,
    "award_programs": ["AF", "KL", "DL", "BA", "AA", "AS", "UA", "VS", "AC", "TK"],
}
filters_cdgtorome = {
    "outbound_date": "2026-02-13",
    "travel_class": "economy",
    "stops": 1,
    "bags": 1,
    "pax": 1,
    "award_programs": ["AF", "KL", "DL", "BA", "AA", "AS", "UA", "VS", "AC", "TK"],
}

user_points_by_trav = {
    "alice": {
        "amex": 90000,
        "chase": 40000,
        "citi": 25000,
        "bilt": 15000,
        "AF": 12000,
        "DL": 20000,
        "AS": 10000,
    },
    "bob": {
        "amex": 60000,
        "capitalone": 50000,
        "citi": 20000,
        "AF": 0,
        "DL": 10000,
        "AA": 8000,
    },
    "carol": {
        "chase": 70000,
        "amex": 30000,
        "citi": 30000,
        "AF": 5000,
        "BA": 7000,
        "UA": 0,
    },
}

transfer_graph = {
    "amex": {
        "AF": 1.0,
        "KL": 1.0,
        "DL": 1.0,
        "BA": 1.0,
        "VS": 1.0,
        "AC": 1.0,
        "TK": 1.0,
    },
    "chase": {"AF": 1.0, "KL": 1.0, "BA": 1.0, "VS": 1.0, "UA": 1.0, "AC": 1.0},
    "citi": {"AF": 1.0, "KL": 1.0, "VS": 1.0, "TK": 1.0, "BA": 1.0},
    "capitalone": {"AF": 1.0, "KL": 1.0, "BA": 1.0, "VS": 1.0, "TK": 1.0, "AC": 1.0},
    "bilt": {
        "AF": 1.0,
        "KL": 1.0,
        "BA": 1.0,
        "AA": 1.0,
        "UA": 1.0,
        "AC": 1.0,
        "TK": 1.0,
        "VS": 1.0,
    },
}
transfer_bonuses = {("amex", "AF"): 1.25}

edges_all = {}
edges_all.update(
    get_flights_award_first_with_points(
        "SEA", "CDG", user_points_by_trav["alice"], filters_alice
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "JFK", "CDG", user_points_by_trav["bob"], filters_bob
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "SFO", "FCO", user_points_by_trav["carol"], filters_carol
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "CDG", "FCO", user_points_by_trav["carol"], filters_cdgtorome
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "AMS",
        "CDG",
        user_points_by_trav["alice"],
        {"outbound_date": "2026-02-11", "travel_class": "economy", "pax": 1},
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "LHR",
        "CDG",
        user_points_by_trav["bob"],
        {"outbound_date": "2026-02-13", "travel_class": "economy", "pax": 1},
    )
)
edges_all.update(
    get_flights_award_first_with_points(
        "AMS",
        "FCO",
        user_points_by_trav["carol"],
        {"outbound_date": "2026-02-13", "travel_class": "economy", "pax": 1},
    )
)

solution = run_ilp_from_edges(
    edges_all,
    travelers,
    start_city,
    end_city,
    user_points_by_trav,
    plan_non_pooled_multi_itineraries_with_native,
    meetup_cities=user_meetups,
    require_meetup_in_graph=True,
    transfer_graph=transfer_graph,
    transfer_bonuses=transfer_bonuses,
    bank_block_size=1000,
    allow_all_payers=True,
    default_cash_if_missing=1e7,
    default_time_if_missing=1e6,
)

print("Status:", solution["status"])
print("\nPaths:")
for p in travelers:
    print(f"  {p}: {' -> '.join(solution['path'][p])}")

print("\nPayments:")
for p in travelers:
    print(f"  {p}:")
    for rec in solution["pay_mode"][p]:
        if rec["type"] == "cash":
            print(f"    cash by {rec['payer']}: {rec['edge']} fare=${rec['fare']:.2f}")
        else:
            via = rec["via"]
            if "native" in via:
                print(
                    f"    miles (native {via['native']}) by {rec['payer']}: {rec['edge']} miles={rec['miles']:.0f}, surcharge=${rec['surcharge']:.2f}"
                )
            else:
                print(
                    f"    miles (transfer {via['source']}→{via['airline']}) by {rec['payer']}: {rec['edge']} miles={rec['miles']:.0f}, surcharge=${rec['surcharge']:.2f}"
                )

print("\nTotals:")
print("  Airline miles used:", solution["totals"]["airline_points"])
print("  Cash used:", solution["totals"]["cash"])
print("  Total travel time (mins):", solution["totals"]["time"])
print("  Transfers:", solution["totals"]["transfers"])
print("  Native used:", solution["totals"]["native_used"])
