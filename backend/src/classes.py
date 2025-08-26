import uuid
from itertools import permutations


class Flight:
    def __init__(
        self,
        flight_id,
        airline,
        source,
        sink,
        depart_time,
        arrival_time,
        cost_in_dollars,
        cost_in_miles,
    ):
        self.id = flight_id
        self.airline = airline
        self.sink = sink  # airport code
        self.source = source  # airport code
        self.depart_time = depart_time
        self.arrival_time = arrival_time
        self.cost_in_dollars = cost_in_dollars
        self.cost_in_miles = cost_in_miles


class Airport:
    def __init__(self, airport_code, flights: list[Flight]):
        self.airport_code = airport_code
        self.flights = flights


class Hotel:
    def __init__(
        self,
        hotel_id,
        hotel_name,
        cost_in_dollars,
        cost_in_points,
        check_in_date,
        checkout_date,
    ):
        self.hotel_id = hotel_id
        self.hotel = hotel_name
        self.cost_in_dollars = cost_in_dollars
        self.check_in_date = check_in_date
        self.checkout_date = checkout_date
        self.cost_in_points = cost_in_points


class City:
    def __init__(
        self,
        city_name,
        country,
        city_code,
        airport: Airport = None,
        hotel: Hotel = None,
        entry_date=None,
        leave_date=None,
    ):
        self.city_name = city_name
        self.country = country
        self.city_code = city_code
        self.start_date = entry_date
        self.end_date = leave_date
        self.airport = airport
        self.hotel = hotel


class User:
    def __init__(self, name, trips_taken):
        self.user_id = uuid.uuid3()
        self.name = name
        self.trips_taken = trips_taken


class GroupTrip:
    def __init__(self, users: list[User]):
        self.users = users
        self.trip_id = uuid.uuid3()


class Trip:
    pass
