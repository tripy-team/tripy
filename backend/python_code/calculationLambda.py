import json
from backend.python_code.classes import User, Airport, Trip, City, Flight
import networkx as nx
from itertools import permutations
import serpapi


def lambda_handler(index, context):
    pass


def generate_shared_itinerary(users: list[User], cities: list[Airport]):
    """Itineraries (for now) only include flights and hotels"""
    for user in users:
        start_airport = user.start_loc
        end_airport = user.end_loc
        user.airport_graph = create_user_graph(cities)
    for airport in cities:
        pass


def optimize(users: list[User], cities: list[Airport] = None):
    airline_prefs = set()
    hotel_prefs = set()
    for user in users:
        airline_prefs.add(user.airline_prefs)
        hotel_prefs.add(user.hotel_prefs)


def get_flights_from_airport(airport: Airport):
    """returns the outbound flights in the format
    "airport_code" :[
        {
        "airport_code": Airport
        "flight": Flight
        "end_airport": airport,
        "cost_in_dollars": int,
        "cost_in_miles": int
        }
    ]
    """
    pass


def create_user_trip(user: User):
    start_loc = user.start_loc
    end_loc = user.end_loc


def create_user_graph(
    start_airport: Airport, end_airport: Airport, destinations: list[Airport]
):
    """we are assuming that everyone is starting from the same airport, initially"""
    G = nx.digraph()
    all_flights = {}
    for destination in destinations:
        start_airport_code = destination.airport_code
        flights_from_airport = get_flights_from_airport(destination)
        all_flights[start_airport_code] = flights_from_airport
        G.add_node(start_airport_code)
        for flight in flights_from_airport[start_airport_code]:
            end_airport_code = flight["end_airport"].airport_code
            cost_in_dollars = flight["cost_in_dollars"]
            cost_in_miles = flight["cost_in_miles"]
            flight_duration = flight["flight"].duration
            G.add_node(end_airport_code)
            G.add_edge(start_airport_code, end_airport_code, weight=flight_duration)
    return G


def create_itinerary(start_city: City, end_city: City, destinations: list[City]):
    destination_permutations = permutations(destinations)
    for permutation in destination_permutations:
        pass


def get_cheapest_path_between_cities(user, start_city, end_city):
    pass


def get_airports_from_city(city: City) -> list[Airport]:
    pass


# for suggestions, keep calling solo_trip for destinations and cities
# look for a way to determine how many days is good enough to travel to one place
# should be able to suggest multiple countries or one country with multiple destinations
# might be good to filter at the end of all the calculations and give suggestions if nothing matches


def create_solo_trip(
    user: User, start_date, end_date, desired_cities: list[City], start_city, end_city
):
    best_option = (0, float("inf"))  # dollars, points
    start_airports = get_airports_from_city(start_city)
    end_airports = get_airports_from_city(end_date)
    node_index = 0
    trip_graph = nx.digraph()
    trip_graph[node_index] = (start_city, 0)
    for start_airport in start_airports:
        running_date = start_date
        for desired_city in desired_cities:
            flights_from_start_airport_to_specific_city = get_flights_from_airport(
                start_airport, desired_city, running_date
            )
            for flight in flights_from_start_airport_to_specific_city:
                pass


def get_flights_from_airport_to_specific_city(
    airport, city, start_date
) -> list[Flight]:
    pass


if __name__ == "__main__":
    pass
