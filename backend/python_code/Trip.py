from classes import User, City, Flight
from itertools import permutations
import uuid


class Trip:
    def __init__(
        self,
        user: User,
        start_date,
        end_date,
        start_city: City,
        end_city: City,
        desired_cities: list[City],
        points_limit,
        budget,
    ):
        self.trip_id = uuid.uuid3()
        self.start_date = start_date
        self.end_date = end_date
        self.desired_cities = desired_cities  # must be less than 6 cities
        self.start_city = start_city
        self.end_city = end_city

    def calculate_maximized_trips(self):
        """dynamic programming algorithm that determines the cheapest path to go from start cities through cities_permutations"""
        desired_cities_permutations = permutations(self.desired_cities)
        trip_path = []
        for cities_permutation in desired_cities_permutations:
            cities_permutation.append(self.end_city)
            flights_from_starting_city = get_flights_from_city_to_city(
                self.start_city, cities_permutation[0]
            )
            cheapest_flights_by_dollar = sorted(
                flights_from_starting_city,
                key=lambda x: x.cost_in_dollars,
                reverse=True,
            )
            cheapest_flights_by_points = sorted(
                flights_from_starting_city, key=lambda x: x.cost_in_miles, reverse=True
            )
            flight_price = (cheapest_flights_by_points, cheapest_flights_by_dollar)
            for flight_index in range(len(flights_from_starting_city)):
                pass


def get_flights_from_city_to_city(starting_city, ending_city) -> list[Flight]:
    pass
