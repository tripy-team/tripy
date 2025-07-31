import uuid


class City:
    def __init__(self, city_name, country, city_code, entry_date=None, leave_date=None):
        self.city_name = city_name
        self.country = country
        self.city_code = city_code
        self.start_date = entry_date
        self.end_date = leave_date


class User:
    def __init__(
        self,
        name,
        points,
        start_date,
        leave_date,
        start_loc: City,
        end_loc: City,
        airline_prefs,
        hotel_prefs,
    ):
        self.name = name
        self.points = points
        self.start_loc = start_loc
        self.end_loc = end_loc
        self.start_date = start_date
        self.leave_date = leave_date
        self.airline_prefs = airline_prefs
        self.hotel_prefs = hotel_prefs


class Flight:
    def __init__(
        self, flight_id, airline, source, sink, duration, cost_in_dollars, cost_in_miles
    ):
        self.id = flight_id
        self.airline = airline
        self.sink = sink  # airport code
        self.source = source  # airport code
        self.duration = duration
        self.cost_in_dollars = cost_in_dollars
        self.cost_in_miles = cost_in_miles


class Hotel:
    def __init__(
        self, hotel_id, hotel_name, city: City, cost_in_dollars, cost_in_points
    ):
        self.hotel_id = hotel_id
        self.hotel = hotel_name
        self.city = city
        self.cost_in_dollars = cost_in_dollars
        self.cost_in_points = cost_in_points


class Airport:
    def __init__(self, airport_code, city: City):
        self.airport_code = airport_code
        self.city = city


class Node:
    def __init__(
        self, city: City, entry_flight: Flight, leaving_flight: Flight, hotel: Hotel
    ):
        self.city = city
        self.entry_flight = entry_flight
        self.leaving_flight = leaving_flight
        self.hotel = hotel


class Trip:
    def __init__(
        self, start_date, end_date, itinerary, cities: list[City], users: list[User]
    ):
        self.trip_id = uuid.uuid3()
        self.start_date = start_date
        self.end_date = end_date
        self.cities = cities
        self.users = users
        self.itinerary = itinerary
