from dotenv import load_dotenv
import json
import requests, json
import os
from domain.util.airport_filter import (
    load_commercial_iata_set_from_web,
    is_commercial_airport,
)

load_dotenv()
from backend.domain.optimize.flights import (
    get_flights_award_first_with_points,
    get_airport_codes,
    get_flights_serp_first_with_points,
)

if __name__ == "__main__":
    # cities = [("seattle", "US"), ("paris", "FR")]
    # print(get_edge_dictionaries(cities))
    commercial_set = load_commercial_iata_set_from_web()
    # print(get_airport_codes("Paris", "FR", commercial_set))

    # print(get_flights_between_cities("SEA", "CDG"), "\n")
    # url = "https://www.awardtool-api.com/search_real_time"

    # payload = json.dumps(
    #     {
    #         "origin": "JFK",
    #         "destination": "LHR",
    #         "programs": ["UA"],
    #         "cabins": ["Economy"],
    #         "date": "2025-12-28",
    #         "pax": "1",
    #         "api_key": os.getenv("AWARD_TOOL_API_KEY"),
    #     }
    # )
    # headers = {
    #     "sec-ch-ua": '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
    #     "Content-Type": "application/json",
    # }

    # response = requests.request("POST", url, headers=headers, data=payload)

    # x = json.loads(response.text)["data"]
    # print(x[0])
    # Cheapest Economy, flexible airlines, light bags
    # filters_econ = {
    #     "outbound_date": "2026-02-11",  # YYYY-MM-DD
    #     "travel_class": "economy",  # economy | premium_economy | business | first
    #     "stops": 1,  # 0 = nonstop only, 1 = up to 1 stop, etc.
    #     "bags": 1,  # checked bags count (SerpAPI param)
    #     "max_price": 16000,  # USD cap for cash fares
    #     # "include_airlines": ["DL", "AF"],  # only these carriers (IATA codes)
    #     # "exclude_airlines": ["FI"],    # OR exclude specific carriers
    #     "pax": 1,  # used by AwardTool helper (if present)
    # }
    # print(get_flights_between_cities("SEA", "CDG", filters_econ))
    # print(
    #     get_edge_dictionaries(
    #         [("Seattle", "US"), ("Paris", "FR"), ("Vienna", "AT")],commercial_set, filters_econ
    #     )
    # )
    # filters_smoke = {
    #     "outbound_date": "2026-02-11",
    #     "travel_class": ["economy"],
    #     # intentionally no stops/bags/max_price to see *any* result
    #     "pax": 1,
    # }
    # SERPAPI_KEY = os.getenv("SERPAPI_KEY")
    # print("SERPAPI_KEY set:", bool(SERPAPI_KEY))
    # print(get_flights_between_cities("SEA", "CDG", filters_smoke))
    user_points = {
        # airline balances
        "AF": 120000,
        "DL": 20000,
        "AS": 15000,
        "AA": 5000,
        "UA": 0,
        # bank currencies (lowercase keys)
        "amex": 80000,
        "chase": 60000,
        "citi": 40000,
        "capitalone": 30000,
        "bilt": 25000,
    }

    filters = {
        "outbound_date": "2026-02-11",
        "travel_class": "economy",  # or 1..4
        "stops": 1,
        "bags": 1,
        "pax": 1,
        "award_programs": [
            "AF",
            "KL",
            "DL",
        ],  # override if you want specific pricing programs
    }

    # Award-first
    edges_award_first = get_flights_award_first_with_points(
        "SEA", "CDG", user_points, filters
    )
    print(edges_award_first, "\n")

    # SERP-first
    edges_serp_first = get_flights_serp_first_with_points(
        "SEA", "CDG", user_points, filters
    )
    print(edges_serp_first, "\n")
