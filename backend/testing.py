from dotenv import load_dotenv
import requests
import json
import requests, json
import os

load_dotenv()
from trips import get_edge_dictionaries
from flights import get_flights_between_cities, get_airport_codes

if __name__ == "__main__":
    # cities = [("seattle", "US"), ("paris", "FR")]
    # print(get_edge_dictionaries(cities))
    # print(get_airport_codes("Paris", "FR"))
    # print(get_flights_between_cities("SEA", "CDG"), "\n")
    url = "https://www.awardtool-api.com/search_real_time"

    payload = json.dumps(
        {
            "origin": "JFK",
            "destination": "LHR",
            "programs": ["UA"],
            "cabins": ["Economy"],
            "date": "2025-12-28",
            "pax": "1",
            "api_key": os.getenv("AWARD_TOOL_API_KEY"),
        }
    )
    headers = {
        "sec-ch-ua": '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
        "Content-Type": "application/json",
    }

    response = requests.request("POST", url, headers=headers, data=payload)

    x = json.loads(response.text)["data"]
    print(x[0])


# If using truststore (mac keychain):
