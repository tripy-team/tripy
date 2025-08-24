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


def lambda_handler(index, context):
    pass


def get_airport_data_from_city(city, countryCode):
    load_dotenv()
    amadeus = Client(
        client_id=os.getenv("AMADEUS_API_KEY"),
        client_secret=os.getenv("AMADEUS_API_SECRET"),
    )

    response = amadeus.reference_data.locations.get(
        countryCode=countryCode, keyword=city, subType=Location.AIRPORT
    )
    city_airport_data_list = response.result["data"]
    return city_airport_data_list


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


def get_flights_between_cities(
    start_city,
    start_city_countryCode,
    end_city=None,
    end_city_countryCode=None,
    filters=None,
):
    start_airport_data = get_airport_data_from_city(start_city, start_city_countryCode)
    if not ((end_city is None) == (end_city_countryCode is None)):
        assert "end_city and end_city_countryCode must either be a string or both none"
    else:
        if end_city and end_city_countryCode is None:
            end_airport_data = None
        else:
            end_airport_data = get_airport_data_from_city(
                end_city, end_city_countryCode
            )
    flights_price_dict = {}

    for start_airport in start_airport_data:
        start_airport_iataCode = start_airport["iataCode"]
        for end_airport in end_airport_data:
            end_airport_iataCode = end_airport["iataCode"]
            params = {
                "deep_search": True,
                "engine": "google_flights",
                "departure_id": start_airport_iataCode,
                "arrival_id": end_airport_iataCode,
                "outbound_date": "2025-08-18",
                "api_key": os.getenv("SERPAPI_KEY"),
                "type": 2,
                "currency": "USD",
            }
            search = GoogleSearch(params)
            results = search.get_dict()
            try:
                for best_flight in results["best_flights"]:
                    print(best_flight["price"])
            except:
                continue
    print(flights_price_dict)


def explore_destinations():
    pass


def get_flights_cost_in_points():
    pass


if __name__ == "__main__":
    load_dotenv()
    get_flights_between_cities("Seattle", "US", "Orlando", "US")
    # get_airport_data_from_city("Seattle", "US")
