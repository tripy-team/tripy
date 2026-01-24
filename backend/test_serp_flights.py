import os

from dotenv import load_dotenv
load_dotenv()
from serpapi import GoogleSearch

params = {
    "engine": "google_flights",
    "departure_id": "PEK",
    "arrival_id": "AUS",
    "outbound_date": "2026-01-24",
    "type": "2",
    # "return_date": "2026-01-30",
    "currency": "USD",
    "hl": "en",
    "api_key": os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY") or "",
}

search = GoogleSearch(params)
results = search.get_dict()
print(results)

def get_flights(origin, destination, date):
    search = GoogleSearch(params)
