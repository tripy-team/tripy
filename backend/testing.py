from dotenv import load_dotenv
import requests
import json
import requests, certifi, json

load_dotenv()
from trips import get_edge_dictionaries
from flights import get_flights_between_cities, get_airport_codes

if __name__ == "__main__":
    cities = [("seattle", "US"), ("paris", "FR")]
    # print(get_edge_dictionaries(cities))
    # print(get_airport_codes("Paris", "FR"))
    # print(get_flights_between_cities("SEA", "CDG"), "\n")
    url = "https://apis.awardtoolapi.com/search_real_time"

    payload = {
        "origin": "JFK",
        "destination": "LHR",
        "programs": ["UA"],
        "cabins": ["Economy"],
        "date": "2025-12-28",
        "pax": "1",
        "api_key": "0363cfd0-ba6a-4302-ba14-9f86186eb0c7",
    }
    headers = {}

    response = requests.request("POST", url=url, headers=headers, data=payload)

    print(response.text)

    # If using truststore (mac keychain):
