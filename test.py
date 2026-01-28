import requests
import json

url = "https://apis.awardtoolapi.com/search_real_time"

payload = '{\n    "origin": "JFK",\n    "destination": "LHR",\n    "programs": ["AA"],\n    "cabins": ["Business", "First", "Economy", "Business"],\n    "date": "2025-12-25",\n    "pax": "1",\n    "task_id": "9a63f644b-15a3f-45dC322-9GGF-2z4Xf2", //Create uuid for each request\n    "api_key": "YOU_API_KEY"\n}'
headers = {}

response = requests.request("POST", url, headers=headers, data=payload)

print(response.text)
