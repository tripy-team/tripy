import os, requests, json
from dotenv import load_dotenv

# Failure class stub - original import doesn't exist
class Failure(Exception):
    pass

load_dotenv()


def flights_with_points_between_cities(start_city, end_city):
    flight_edges = {}
    params = create_filters("insert here")
    params["origin"] = start_city
    params["destination"] = end_city
    params["api_key"] = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
    url = "https://www.awardtool-api.com/search_real_time"
    headers = {
        "sec-ch-ua": '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
        "Content-Type": "application/json",
    }
    payload = json.dumps(params)
    response = requests.request("POST", url, headers=headers, data=payload)

    response = json.loads(response.text)
    if response["status"] != 200:
        raise Failure(f"Failed to use awardtools to generate flights from {start_city} to {end_city} on {params["date"]}")
    data = response["data"]
    for flight in data:
        cabin_prices = flight["cabin_prices"]
        airline_code = flight["airline_code"]
    return response.text


def get_prices_from_cabin_prices(cabin_prices):
    econ = cabin_prices.get("Economy")
    prem = cabin_prices.get("Premium Economy")
    bus = cabin_prices.get("Business")
    first = cabin_prices.get("First")
    

def process_cabin_prices(cabin):
    if not cabin:
        segments = cabin["segments"]
        miles_cost = cabin["miles"]
        tax = cabin["tax"]
        transfer_option = cabin["transfer_options"]




def create_filters(frontend_filter):
    return {
        "pax": 2,
        "programs": ["DL"],
        "cabins": ["Economy"],
        "date": "2025-10-18",
    }


if __name__ == "__main__":
    print(flights_with_points_between_cities("SEA", "FLL"))
