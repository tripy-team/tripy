# backend/trips.py  (updated lightly)
from typing import List, Tuple, Dict, Any
from itertools import product
from backend.domain.optimize.flights import get_airport_codes

# get_flights_between_cities,


def create_city_pairs(cities, commercial_set):
    """
    cities: list of (city_name, country_code)
    Returns pairs between every distinct pair of groups (i < j),
    includes both directions, skips (x, x).
    """
    cities_iata_codes = [
        get_airport_codes(city, cc, commercial_set) for city, cc in cities
    ]

    pairs = []
    for i in range(len(cities_iata_codes)):
        for j in range(i + 1, len(cities_iata_codes)):
            A, B = cities_iata_codes[i], cities_iata_codes[j]
            pairs.extend([(a, b) for a, b in product(A, B) if a != b])  # A -> B
            pairs.extend([(b, a) for b, a in product(B, A) if b != a])  # B -> A
    return pairs


# def get_edge_dictionaries(cities, commercial_set, filters=None):
#     """
#     Returns a JSON-friendly payload with every field we have per edge, and also a by_program view.
#     Structure:
#     {
#       "edges": [ {origin, destination, flight_number, cash_cost, time_cost, points_cost, points_program, points_surcharge, transfer_partners}, ... ],
#       "by_program": { "AA": [ ...same edge dicts... ], ... }
#     }
#     """
#     out = {"edges": [], "by_program": {}}

#     for start_iata, end_iata in create_city_pairs(cities, commercial_set):
#         flight_details = get_flights_between_cities(start_iata, end_iata, filters)
#         print(flight_details, "\n")

#         for edge, details in flight_details.items():
#             origin, destination, flight_number = edge

#             item = {
#                 "origin": origin,
#                 "destination": destination,
#                 "flight_number": flight_number,
#                 "cash_cost": details.get("cash_cost"),
#                 "time_cost": details.get("time_cost"),
#                 "points_cost": details.get("points_cost"),
#                 "points_program": details.get("points_program"),
#                 "points_surcharge": details.get("points_surcharge"),
#                 "transfer_partners": details.get("transfer_partners") or [],
#             }

#             out["edges"].append(item)

#             prog = item.get("points_program") or ""
#             if prog:
#                 out["by_program"].setdefault(prog, []).append(item)

#     return out
