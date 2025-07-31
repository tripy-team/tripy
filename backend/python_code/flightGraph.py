import os
import pulp
from amadeus import Client as Amadeus
from serpapi import GoogleSearch
from typing import List, Dict, Tuple
from dotenv import load_dotenv


# ----- Data classes -----
class User:
    def __init__(self, name: str, points: Dict[str, float]):
        """
        name: identifier for the traveler
        points: mapping from credit-card currency code to available balance
        """
        self.name = name
        self.points = points


class FlightOption:
    def __init__(
        self,
        id: str,
        cash_cost: float,
        miles_required: float,
        airline: str,
        duration: float,
        departure: str,
    ):
        self.id = id
        self.cash_cost = cash_cost
        self.miles_required = miles_required
        self.airline = airline
        self.duration = duration  # in minutes
        self.departure = departure


class HotelOption:
    def __init__(
        self,
        id: str,
        cash_cost: float,
        points_required: float,
        brand: str,
        distance_to_center: float,
    ):
        self.id = id
        self.cash_cost = cash_cost
        self.points_required = points_required
        self.brand = brand
        self.distance_to_center = distance_to_center  # in km


# ----- API fetch stubs -----
def fetch_flight_options(
    amadeus_client: Amadeus,
    origin: str,
    dest: str,
    date: str,
    allowed_airlines: List[str],
) -> List[FlightOption]:
    """
    Replace this stub with actual Amadeus API calls. Return a list of FlightOption.
    """
    raise NotImplementedError(
        "fetch_flight_options must be implemented with Amadeus API"
    )


def fetch_hotel_options(
    location: str, checkin: str, checkout: str, allowed_brands: List[str]
) -> List[HotelOption]:
    """
    Replace this stub with your hotel provider API or web-scraping logic. Return a list of HotelOption.
    """
    raise NotImplementedError(
        "fetch_hotel_options must be implemented with your chosen hotel API"
    )


# ----- Transfer bonus lookup -----
def get_transfer_bonus(cc_currency: str, program: str) -> float:
    """
    Return a multiplier for transfer bonus (e.g. 1.25 for +25%).
    Use web scraping or SerpAPI to get live values.
    """
    # Example stub assumes no bonus
    return 1.0


# ----- Core optimization -----
def optimize_itinerary(
    users: List[User],
    flight_opts: List[FlightOption],
    hotel_opts: List[HotelOption],
    weight_commute: float,
    budget_points: Dict[str, float],
    objective: str = "min_cash",
) -> Dict:
    prob = pulp.LpProblem(
        "itinerary_opt", pulp.LpMinimize if objective == "min_cash" else pulp.LpMaximize
    )

    # Decision variables
    x_f = {f.id: pulp.LpVariable(f"flight_{f.id}", cat="Binary") for f in flight_opts}
    x_h = {h.id: pulp.LpVariable(f"hotel_{h.id}", cat="Binary") for h in hotel_opts}

    # Exactly one flight & one hotel
    prob += pulp.lpSum(x_f.values()) == 1
    prob += pulp.lpSum(x_h.values()) == 1

    # Transfer variables
    transfer = {}
    for u in users:
        for c in u.points:
            for f in flight_opts:
                transfer[(u.name, c, f.id)] = pulp.LpVariable(
                    f"trans_{u.name}_{c}_{f.id}", lowBound=0
                )

    # Objective terms
    cash_cost = pulp.lpSum(f.cash_cost * x_f[f.id] for f in flight_opts) + pulp.lpSum(
        h.cash_cost * x_h[h.id] for h in hotel_opts
    )
    transfer_fees = pulp.lpSum(
        transfer[(u.name, c, f.id)] * 0.015
        for u in users
        for c in u.points
        for f in flight_opts
    )
    commute_penalty = weight_commute * pulp.lpSum(
        f.duration * x_f[f.id] for f in flight_opts
    )

    if objective == "min_cash":
        prob += cash_cost + transfer_fees + commute_penalty
    else:
        value_term = pulp.lpSum(
            f.cash_cost * x_f[f.id] for f in flight_opts
        ) + pulp.lpSum(h.cash_cost * x_h[h.id] for h in hotel_opts)
        prob += value_term - (transfer_fees + commute_penalty)

    # Constraints: ensure transfers cover required miles
    for u in users:
        for f in flight_opts:
            prob += (
                pulp.lpSum(
                    transfer[(u.name, c, f.id)] * get_transfer_bonus(c, f.airline)
                    for c in u.points
                )
                >= f.miles_required * x_f[f.id]
            )
            for c in u.points:
                prob += transfer[(u.name, c, f.id)] <= u.points[c]

    # Solve
    prob.solve(pulp.PULP_CBC_CMD(msg=False))

    # Extract solution
    chosen_f = next(f for f in flight_opts if x_f[f.id].value() == 1)
    chosen_h = next(h for h in hotel_opts if x_h[h.id].value() == 1)
    transfer_plan = {
        (u.name, c): transfer[(u.name, c, chosen_f.id)].value()
        for u in users
        for c in u.points
        if transfer[(u.name, c, chosen_f.id)].value() > 0
    }

    return {
        "flight": chosen_f,
        "hotel": chosen_h,
        "transfer_plan": transfer_plan,
        "objective_value": pulp.value(prob.objective),
    }


# ----- Public API -----
def suggest_itineraries(
    users: List[User],
    origin: str,
    dest: str,
    date: str,
    location: str,
    checkin: str,
    checkout: str,
    allowed_airlines: List[str],
    allowed_brands: List[str],
    weight_commute: float,
    budget_points: Dict[str, float],
) -> Tuple[Dict, Dict]:
    # Load Amadeus credentials from environment
    ama_id = os.getenv("AMADEUS_CLIENT_ID")
    ama_secret = os.getenv("AMADEUS_CLIENT_SECRET")
    if not ama_id or not ama_secret:
        raise ValueError(
            "Missing Amadeus credentials. Please set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET."
        )
    amadeus_client = Amadeus(client_id=ama_id, client_secret=ama_secret)

    # Fetch options
    flights = fetch_flight_options(amadeus_client, origin, dest, date, allowed_airlines)
    hotels = fetch_hotel_options(location, checkin, checkout, allowed_brands)

    min_opt = optimize_itinerary(
        users, flights, hotels, weight_commute, budget_points, "min_cash"
    )
    max_opt = optimize_itinerary(
        users, flights, hotels, weight_commute, budget_points, "max_value"
    )

    return min_opt, max_opt


# ----- Main block for direct execution -----
if __name__ == "__main__":
    load_dotenv()
    # Example usage: set environment vars before running:
    # export AMADEUS_CLIENT_ID=your_id
    # export AMADEUS_CLIENT_SECRET=your_secret

    users = [
        User("Alice", {"Chase": 50000, "Amex": 30000}),
        User("Bob", {"Chase": 20000}),
    ]
    origin = "SFO"
    dest = "LAX"
    date = "2025-08-15"
    location = "Los Angeles, CA"
    checkin = "2025-08-15"
    checkout = "2025-08-18"
    allowed_airlines = ["UA", "AA"]
    allowed_brands = ["Marriott", "Hilton"]
    weight_commute = 0.1
    budget_points = {}

    try:
        min_itin, max_itin = suggest_itineraries(
            users,
            origin,
            dest,
            date,
            location,
            checkin,
            checkout,
            allowed_airlines,
            allowed_brands,
            weight_commute,
            budget_points,
        )

        print("=== Minimize Cash Itinerary ===")
        print("Flight:", vars(min_itin["flight"]))
        print("Hotel:", vars(min_itin["hotel"]))
        print("Transfer Plan:", min_itin["transfer_plan"])
        print("Objective Value:", min_itin["objective_value"])

        print("\n=== Maximize Value Itinerary ===")
        print("Flight:", vars(max_itin["flight"]))
        print("Hotel:", vars(max_itin["hotel"]))
        print("Transfer Plan:", max_itin["transfer_plan"])
        print("Objective Value:", max_itin["objective_value"])
    except ValueError as e:
        print(f"Error: {e}")
