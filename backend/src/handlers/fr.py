import os, requests, json, sys
from pathlib import Path

from dotenv import load_dotenv

# Ensure backend is on path when run as script from handlers/
_here = Path(__file__).resolve().parent
_backend = _here.parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

# Failure class stub - original import doesn't exist
class Failure(Exception):
    pass

load_dotenv()


def flights_with_points_between_cities(start_city, end_city):
    flight_edges = {}
    params = create_filters("insert here")
    params["origin"] = start_city
    params["destination"] = end_city
    params["api_key"] = "0363cfd0-ba6a-4302-ba14-9f86186eb0c7"
    url = "https://www.awardtool-api.com/search_real_time"
    headers = {
        "sec-ch-ua": '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
        "Content-Type": "application/json",
    }
    payload = json.dumps(params)
    response = requests.request("POST", url, headers=headers, data=payload)

    response = json.loads(response.text)
    if response.get("status") != 200:
        # Fallback to serp_client.get_flights_between_airports when AwardTool fails
        try:
            from src.handlers.serp_client import get_flights_between_airports
            date = params.get("date", "2026-02-18")
            flights = get_flights_between_airports(start_city, end_city, date)
            if flights:
                return json.dumps({"status": 200, "source": "serp", "flights": flights})
        except Exception:
            pass
        raise Failure(
            f"Failed to use awardtools to generate flights from {start_city} to {end_city} on {params.get('date', '')}"
        )
    data = response.get("data", [])
    for flight in data:
        cabin_prices = flight.get("cabin_prices")
        airline_code = flight.get("airline_code")
    return json.dumps(response) if isinstance(response, dict) else response


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
        "date": "2026-02-18",
    }


if __name__ == "__main__":
    print(flights_with_points_between_cities("SEA", "FLL"))
