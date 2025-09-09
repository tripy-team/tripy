# backend/trips.py  (updated lightly)
from typing import List, Tuple, Dict, Any
from itertools import product
from flights import get_flights_between_cities, get_airport_codes


def create_city_pairs(cities):
    """
    cities: list of (city_name, country_code)
    Returns pairs between every distinct pair of groups (i < j),
    includes both directions, skips (x, x).
    """
    cities_iata_codes = [get_airport_codes(city, cc) for city, cc in cities]

    pairs = []
    for i in range(len(cities_iata_codes)):
        for j in range(i + 1, len(cities_iata_codes)):
            A, B = cities_iata_codes[i], cities_iata_codes[j]
            pairs.extend([(a, b) for a, b in product(A, B) if a != b])  # A -> B
            pairs.extend([(b, a) for b, a in product(B, A) if b != a])  # B -> A
    return pairs


def get_edge_dictionaries(
    cities: List[List[str]], filters: Dict[str, Any] = None
) -> Dict[str, Any]:
    cash_cost: Dict[tuple, Any] = {}
    time_cost: Dict[tuple, Any] = {}
    points_cost: Dict[str, Dict[tuple, Any]] = {}
    edges: List[tuple] = []
    for start_iata, end_iata in create_city_pairs(cities):
        flight_details = get_flights_between_cities(start_iata, end_iata, filters)
        for edge, details in flight_details.items():
            edges.append(edge)
            cash_cost[edge] = details.get("cash_cost")
            time_cost[edge] = details.get("time_cost")
            airline_code = (edge[2] or "")[:2] if len(edge) > 2 else ""
            if airline_code:
                points_cost.setdefault(airline_code, {})[edge] = (
                    details.get("points") or {}
                ).get("raw")

    return {
        "edges": edges,
        "cash_costs": cash_cost,
        "time_costs": time_cost,
        "points_costs": points_cost,
    }
