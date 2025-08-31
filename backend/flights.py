import json
import requests
from dotenv import load_dotenv
import os
import boto3
from amadeus import Client, Location, ResponseError
import allcities
from serpapi import GoogleSearch
from classes import Flight, Airport
from openai import OpenAI
from pydantic import BaseModel
from datetime import date
import re


def lambda_handler(index, context):
    pass


def get_airport_data_from_city(city, countryCode):
    if not ((city is None) == (countryCode is None)):
        assert "end_city and end_city_countryCode must either be a string or both none"
    else:
        if city is None or countryCode is None:
            return [None]

    load_dotenv()
    amadeus = Client(
        client_id=os.getenv("AMADEUS_API_KEY"),
        client_secret=os.getenv("AMADEUS_API_SECRET"),
    )

    response = amadeus.reference_data.locations.get(
        countryCode=countryCode, keyword=city, subType=Location.AIRPORT
    )
    city_airport_data_list = response.result["data"]
    iataCodes = []
    for city_airport_data in city_airport_data_list:
        iataCodes.append(city_airport_data["iataCode"])
    return iataCodes


def create_flight_filters():
    filters = {
        "deep_search": True,
        "start_city": None,
        "start_city_country_code": None,
        "end_city": None,
        "end_city_country_code": None,
        "type": None,
        "outbound_date": None,
        "return_date": None,
        "travel_class": None,
        "multi_city_json": None,
        "passengers": {
            "adults": 0,
            "childern": 0,
            "infants_in_seat": 0,
            "infants_on_lap": 0,
        },
        "stops": 0,
        "exclude_airlines": None,
        "include_airlines": None,
        "bags": 0,
        "max_price": None,
        "outbound_times": None,
        "emissions": None,
        "layover_duration": None,
        "exclude_conns": None,
        "max_duration": None,
    }
    return filters


def create_hotel_filters():
    pass


def get_airport_codes(city, country):
    return get_airport_data_from_city(city, country)


def get_flights_between_cities(start_iata_codes, end_iata_codes, filters=None):
    flight_details = {}
    for start_airport_iata in start_iata_codes:
        for end_airport_iata in end_iata_codes:
            params = {
                "deep_search": True,
                "engine": "google_flights",
                "departure_id": start_airport_iata,
                "arrival_id": end_airport_iata,
                "outbound_date": "2025-10-18",
                "api_key": os.getenv("SERPAPI_KEY"),
                "type": 2,
                "currency": "USD",
            }
            if filters is not None:
                params = {**params, **filters}
            search = GoogleSearch(params)
            results = search.get_dict()
            if "best_flights" in results:
                best_flights = results["best_flights"]
                for best_flight in best_flights:
                    flights = best_flight["flights"]
                    for flight in flights:
                        departure_airport = flight["departure_airport"]
                        arrival_airport = flight["arrival_airport"]
                        start_match = re.search(
                            r"\b\d{4}-\d{2}-\d{2}\s+(\d{2}):\d{2}\b",
                            departure_airport["time"],
                        )
                        if start_match:
                            start_hour = int(start_match.group(1))
                        else:
                            assert "departure time not found"
                        end_match = re.search(
                            r"\b\d{4}-\d{2}-\d{2}\s+(\d{2}):\d{2}\b",
                            arrival_airport["time"],
                        )
                        if end_match:
                            end_hour = int(end_match.group(1))
                        else:
                            assert "arrival time not found"
                        single_unit_params = {
                            "deep_search": True,
                            "engine": "google_flights",
                            "api_key": os.getenv("SERPAPI_KEY"),
                            "type": 2,
                            "departure_id": departure_airport["id"],
                            "arrival_id": arrival_airport["id"],
                            "outbound_date": "2025-10-18",
                            "outbound_times": f"{start_hour},{start_hour+1},{end_hour},{end_hour+1}",
                        }
                        single_unit_search = GoogleSearch(single_unit_params).get_dict()
                        flight_details = flight_details | generate_flight_details_dict(
                            single_unit_search
                        )
    return flight_details


def generate_flight_details_dict(single_unit_search):
    edge_detail = {}
    # in the case that "other_flights is not there or when best flights is there"
    other_flights = single_unit_search["other_flights"]
    flight = other_flights[0]["flights"][0]
    cash_cost = other_flights[0]["price"]
    duration = other_flights[0]["total_duration"]
    cities_names = (
        flight["departure_airport"]["id"],
        flight["arrival_airport"]["id"],
        flight["flight_number"],
    )
    cities_data = {
        "cash_cost": cash_cost,
        "time_cost": duration,
        "points_cost": get_points_cost(single_unit_search),
    }
    edge_detail[cities_names] = cities_data
    return edge_detail


def get_points_cost(single_unit_search):
    return {
        # airline: {("city, city"): points}
        "UR": {("SEA", "JFK"): 15000, ("JFK", "AMS"): 17000},
        "MR": {("SEA", "CDG"): 30000, ("CDG", "AMS"): 8000},
    }


if __name__ == "__main__":
    load_dotenv()
    # get_flights_between_cities("Seattle", "US", "Orlando", "US")
    # print(get_airport_data_from_city("Seattle", "US"))
    seattle_airports = get_airport_codes("seattle", "US")
    orlando_airports = get_airport_codes("orlando", "US")
    print(get_flights_between_cities(["PAE"], ["MCO"]))
