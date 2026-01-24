# examples/group_multicity_demo.py
# Requires:
#  - flights.get_flights_award_first_with_points (award-first)
#  - ilp_adapter.run_ilp_from_edges (adapter with meetup_cities support)
#  - planTrip.plan_non_pooled_multi_itineraries_with_native (your ILP)

from .flights import get_flights_award_first_with_points
from .ilp_adapter import run_ilp_from_edges
from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH, get_award_programs_for_api
try:
    from .planTrip import plan_non_pooled_multi_itineraries_with_native
except ModuleNotFoundError:
    plan_non_pooled_multi_itineraries_with_native = None

# -----------------------------
# Travelers, endpoints, dates
# -----------------------------
travelers = ["alice", "bob", "carol"]

# Different starts / different ends (multi-city)
start_city = {
    "alice": "SEA",  # Seattle
    "bob": "JFK",  # New York
    "carol": "SFO",  # San Francisco
}
end_city = {
    "alice": "CDG",  # Paris
    "bob": "CDG",  # Paris (group meetup)
    "carol": "FCO",  # Rome (multi-city end)
}

# (User picks meetup cities in the UI; keep empty [] for no enforced meetup)
user_meetups = ["CDG"]  # e.g., ["CDG"] or ["CDG","AMS"] or []

# -----------------------------
# Different dates per traveler
# -----------------------------
filters_alice = {
    "outbound_date": "2026-02-11",
    "travel_class": "economy",
    # Allow multistop flights (nonstop, 1-stop, 2-stop, etc.) - no stops restriction
    "bags": 1,
    "pax": 1,
    "award_programs": get_award_programs_for_api(),
}
filters_bob = {
    "outbound_date": "2026-02-13",
    "travel_class": "economy",
    "bags": 1,
    "pax": 1,
    "award_programs": get_award_programs_for_api(),
}
filters_carol = {
    "outbound_date": "2026-02-12",
    "travel_class": "economy",
    "bags": 1,
    "pax": 1,
    "award_programs": get_award_programs_for_api(),
}
filters_cdgtorome = {
    "outbound_date": "2026-02-13",
    "travel_class": "economy",
    "bags": 1,
    "pax": 1,
    "award_programs": get_award_programs_for_api(),
}

# -----------------------------
# Balances per traveler
# (banks = lowercase keys, airlines = UPPER)
# -----------------------------
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

# Transfer graph: all commercial airlines (from src.utils.award_programs)
transfer_graph = DEFAULT_TRANSFER_GRAPH
transfer_bonuses = {("amex", "AF"): 1.25}  # e.g., 25% Amex->AF promo

# -----------------------------
# 1) Build the route union across travelers/dates
# -----------------------------
edges_all = {}

# Alice: SEA -> CDG (Feb 11)
edges_all.update(
    get_flights_award_first_with_points(
        "SEA", "CDG", user_points_by_trav["alice"], filters_alice
    )
)

# Bob: JFK -> CDG (Feb 13)
edges_all.update(
    get_flights_award_first_with_points(
        "JFK", "CDG", user_points_by_trav["bob"], filters_bob
    )
)

# Carol: SFO -> FCO (Feb 12)
edges_all.update(
    get_flights_award_first_with_points(
        "SFO", "FCO", user_points_by_trav["carol"], filters_carol
    )
)

# Optional connector so Carol could route via Paris if optimal:
edges_all.update(
    get_flights_award_first_with_points(
        "CDG", "FCO", user_points_by_trav["carol"], filters_cdgtorome
    )
)

# (Optional) some intra-Europe options for flexibility
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

# -----------------------------
# 2) Run the ILP
# -----------------------------
solution = run_ilp_from_edges(
    edges_all,
    travelers,
    start_city,
    end_city,
    user_points_by_trav,
    plan_non_pooled_multi_itineraries_with_native,
    meetup_cities=user_meetups,  # <- USER-CHOSEN meetup(s)
    require_meetup_in_graph=True,  # helpful error if meetup city has no edges
    transfer_graph=transfer_graph,
    transfer_bonuses=transfer_bonuses,
    bank_block_size=1000,
    allow_all_payers=True,  # group can sponsor each other
    default_cash_if_missing=1e7,  # discourage cash if SERP missing
    default_time_if_missing=1e6,  # discourage unknown durations
)

# -----------------------------
# 3) Inspect solution
# -----------------------------
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
                    f"    miles (native {via['native']}) by {rec['payer']}: {rec['edge']} "
                    f"miles={rec['miles']:.0f}, surcharge=${rec['surcharge']:.2f}"
                )
            else:
                print(
                    f"    miles (transfer {via['source']}→{via['airline']}) by {rec['payer']}: {rec['edge']} "
                    f"miles={rec['miles']:.0f}, surcharge=${rec['surcharge']:.2f}"
                )

print("\nTotals:")
print("  Airline miles used:", solution["totals"]["airline_points"])
print("  Cash used:", solution["totals"]["cash"])
print("  Total travel time (mins):", solution["totals"]["time"])
print("  Transfers:", solution["totals"]["transfers"])
print("  Native used:", solution["totals"]["native_used"])
