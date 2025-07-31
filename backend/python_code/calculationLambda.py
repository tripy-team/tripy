import json
from backend.python_code.classes import User, City, Node
import networkx as nx


def lambda_handler(index, context):
    pass


def generate_itinerary(users, cities: list[City]):
    """Itineraries (for now) only include flights and hotels"""
    city_graph = create_graph(cities)
    for city in cities:
        pass


def optimize(users: list[User], cities: list[City] = None):
    airline_prefs = set()
    hotel_prefs = set()
    for user in users:
        airline_prefs.add(user.airline_prefs)
        hotel_prefs.add(user.hotel_prefs)


def get_flights_from_city(city: City):
    """returns the outbound flights in the format
    "city_code" :[
        {
        "airport_code": Airport
        "flight": Flight
        "end_city": City,
        "cost_in_dollars": int,
        "cost_in_miles": int
        }
    ]
    """
    pass


def create_graph(cities: list[City]):
    """we are assuming that everyone is starting from the same city, initially"""
    G = nx.digraph()
    all_flights = {}
    for city in cities:
        start_city_code = city.city_code
        flights_from_city = get_flights_from_city(city)
        all_flights[start_city_code] = flights_from_city
        G.add_node(start_city_code)
        for flight in flights_from_city[start_city_code]:
            end_city_code = flight["end_city"].city_code
            cost_in_dollars = flight["cost_in_dollars"]
            cost_in_miles = flight["cost_in_miles"]
            flight_duration = flight["flight"].duration
            G.add_node(end_city_code)
            G.add_edge(start_city_code, end_city_code, weight=flight_duration)
    return G


if __name__ == "__main__":
    pass
