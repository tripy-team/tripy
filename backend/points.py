import os
from dotenv import load_dotenv
import requests
import json


def get_points_cost(edge, filters):
    load_dotenv()
    origin, destination, flight_num = edge
    program = flight_num[:2]
    url = "https://www.awardtool-api.com/search_real_time"
    payload_params = {
        "origin": origin,
        "destination": destination,
        "programs": [program],
        "cabins": [filters["cabin"]],
        "date": filters["date"],
        "pax": filters["num_people"],
        "api_key": os.getenv("AWARD_TOOL_API_KEY"),
    }
    headers = {
        "sec-ch-ua": '"Google Chrome";v="119", "Chromium";v="119", "Not?A_Brand";v="24"',
        "Content-Type": "application/json",
    }
    response = requests.request(
        "POST", url, headers=headers, data=json.dumps(payload_params)
    )
    print(response.text)
