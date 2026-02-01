#!/usr/bin/env python3
"""
Custom test for SEA -> CDG on Feb 11, 2026 with Amex Membership Rewards only.
NO MOCK DATA - Shows actual API responses and errors.

Uses two separate API structures:
1. FLIGHTS: apisv2.awardtoolapi.com (priming + polling)
2. HOTELS: awardtool-api.com/api/hotel_calendar (direct)
"""

import json
import os
import sys
import time
import uuid
from datetime import datetime

try:
    import requests
except ImportError:
    print("Error: requests package required. Install with: pip install requests")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Warning: python-dotenv not installed. Using environment variables directly.")

# API Keys
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")

print(f"\n{'='*80}")
print("  API KEY STATUS")
print(f"{'='*80}")
print(f"  AWARD_TOOL_API_KEY: {'SET (' + AWARD_TOOL_API_KEY[:8] + '...)' if AWARD_TOOL_API_KEY else 'NOT SET'}")
print(f"{'='*80}\n")

if not AWARD_TOOL_API_KEY:
    print("ERROR: AWARD_TOOL_API_KEY is not set. Cannot proceed.")
    sys.exit(1)

# =============================================================================
# FLIGHT API CONFIGURATION (apisv2.awardtoolapi.com)
# =============================================================================

FLIGHT_PRIMING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_trigger/search_real_time"
FLIGHT_POLLING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_retrieval/search_result"

POLLING_INTERVAL = 5  # seconds
MAX_POLLING_TIME = 90  # seconds

# Amex transfer partner airline programs
AMEX_AIRLINE_PROGRAMS = ["DL", "B6", "AF", "BA", "SQ", "CX", "EK", "VS", "AV", "AS"]

# Split into batches for priming (as shown in example)
AMEX_PROGRAM_LISTS = [
    ["DL", "B6", "AS"],
    ["AF", "BA", "VS"],
    ["SQ", "CX", "EK", "AV"],
]

# =============================================================================
# HOTEL API CONFIGURATION (awardtool-api.com)
# =============================================================================

HOTEL_CALENDAR_ENDPOINT = "https://www.awardtool-api.com/api/hotel_calendar"

# Headers required for hotel API
HOTEL_HEADERS = {
    "authority": "api.awardtool.com",
    "accept": "application/json, text/plain, */*",
    "accept-language": "en-US,en;q=0.9",
    "authentication": "eyJraWQiOiIzRGZJWWhXODVoYkxtRVYrZXp1ZmM1SEJrUUl2bTczSkZCVUVHYklidDUwPSIsImFsZyI6IlJTMjU2In0.eyJhdF9oYXNoIjoianI0c21rNG82M1RDOG5rVmFHamN4ZyIsInN1YiI6Ijc0YzhjNDI4LTcwZDEtNzA1NS00ZTQ5LWMzNzg3MGU1MjFhYSIsImNvZ25pdG86Z3JvdXBzIjpbInVzLWVhc3QtMV9CUDdGMHBjaUZfR29vZ2xlIl0sImVtYWlsX3ZlcmlmaWVkIjpmYWxzZSwiaXNzIjoiaHR0cHM6XC9cL2NvZ25pdG8taWRwLnVzLWVhc3QtMS5hbWF6b25hd3MuY29tXC91cy1lYXN0LTFfQlA3RjBwY2lGIiwiY29nbml0bzp1c2VybmFtZSI6Imdvb2dsZV8xMTUzMDA5MzYxMTkwMzc3NDIyMDEiLCJvcmlnaW5fanRpIjoiY2E3ODlmODUtMjg1Yy00OTFlLWJlODktYjU1ZDViYTMxMTRjIiwiYXVkIjoiMmx1NTk0bmF2ZmNobHRrb3BxbG1rOGx1YzciLCJpZGVudGl0aWVzIjpbeyJ1c2VySWQiOiIxMTUzMDA5MzYxMTkwMzc3NDIyMDEiLCJwcm92aWRlck5hbWUiOiJHb29nbGUiLCJwcm92aWRlclR5cGUiOiJHb29nbGUiLCJpc3N1ZXIiOm51bGwsInByaW1hcnkiOiJ0cnVlIiwiZGF0ZUNyZWF0ZWQiOiIxNjkzMDg4ODU1MzU2In1dLCJ0b2tlbl91c2UiOiJpZCIsImF1dGhfdGltZSI6MTY5NDUwNzAwMSwiZXhwIjoxNjk0NTYzMzgxLCJpYXQiOjE2OTQ1NTk3ODEsImp0aSI6IjJjN2RmNWUyLTZkYzgtNGVlZi1iNTA4LWQyMTcyNzNiYTEyNCIsImVtYWlsIjoiaHVudGVyLnByb21lQGdtYWlsLmNvbSJ9.SbDAHKB1CxRtdK6adleW5Yplbv_x7BmKegjDk389uZV4fT25dANBslsL8_9zsjDLNNOGwAAzDCOj_Mh6P30ozm6235hjiCjNpOq7b-mIZ36_uj9M2nQNHSgbtD6LSUPzP3AK77-z1Zp_VMXkLLtRs33YnzfbsH6iBMxzpfO4HaLiqKxNsy-0jhMT4SLHqT_zkPxqHI5iG6FqfB3KFlyybv9RYS5VfRHq3OHSAn703lyEfEzfPWQo6314WT_NttIk2kxBpVnESUDfsBHzxMa3zZzvHfQVJt0CyrGJlkzX_m65_dZnEZgj4K6mtEddVHgNXj_7YNvWW8zpE-BpzTVTlw",
    "content-type": "application/json",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36",
}

# Amex transfer partner hotel programs (hotel_id format: brand_shortcode)
# Example hotels that Amex can transfer to (Hilton, Marriott)
# Use known working hotel IDs
SAMPLE_HOTELS = [
    {"hotel_id": "hyatt_madel", "name": "Hyatt Madeleine (Paris)", "brand": "Hyatt"},  # Known working
    {"hotel_id": "hilton_parisconcorde", "name": "Hilton Paris Concorde", "brand": "Hilton"},
    {"hotel_id": "marriott_champsely", "name": "Marriott Champs Elysees", "brand": "Marriott"},
]

# =============================================================================
# FLIGHT API FUNCTIONS
# =============================================================================

def send_flight_priming_request(task_id: str, origin: str, destination: str, date: str, 
                                 program_lists: list, cabins: list = None):
    """
    Send priming requests to initiate flight search.
    Returns True if at least one priming request succeeded.
    """
    cabins = cabins or ["Economy", "Business"]
    
    print(f"\n  [FLIGHT PRIMING] Starting search for {origin} -> {destination} on {date}")
    print(f"  [FLIGHT PRIMING] Task ID: {task_id}")
    print(f"  [FLIGHT PRIMING] Endpoint: {FLIGHT_PRIMING_ENDPOINT}")
    
    headers = {"Content-Type": "application/json"}
    success_count = 0
    
    for program_list in program_lists:
        request_body = {
            "date": date,
            "origin": origin,
            "destination": destination,
            "pax": 1,
            "programs": program_list,
            "cabins": cabins,
            "task_id": task_id,
            "api_key": AWARD_TOOL_API_KEY,
            "exit_early": True,
        }
        
        print(f"  [FLIGHT PRIMING] Sending for programs: {program_list}")
        
        try:
            response = requests.post(
                FLIGHT_PRIMING_ENDPOINT,
                json=request_body,
                headers=headers,
                timeout=15
            )
            
            if response.status_code == 200:
                print(f"  [FLIGHT PRIMING] ✓ Success for {program_list}")
                success_count += 1
            else:
                print(f"  [FLIGHT PRIMING] ✗ Failed for {program_list}: {response.status_code}")
                print(f"  [FLIGHT PRIMING] Response: {response.text[:500]}")
                
        except requests.exceptions.Timeout:
            print(f"  [FLIGHT PRIMING] ✗ Timeout for {program_list}")
        except requests.exceptions.RequestException as e:
            print(f"  [FLIGHT PRIMING] ✗ Error for {program_list}: {e}")
    
    print(f"  [FLIGHT PRIMING] Completed: {success_count}/{len(program_lists)} successful")
    return success_count > 0


def poll_for_flight_results(task_id: str):
    """
    Poll for flight results until search completes or timeout.
    Returns list of all flights found.
    """
    print(f"\n  [FLIGHT POLLING] Starting polling phase")
    print(f"  [FLIGHT POLLING] Endpoint: {FLIGHT_POLLING_ENDPOINT}")
    print(f"  [FLIGHT POLLING] Max time: {MAX_POLLING_TIME}s, Interval: {POLLING_INTERVAL}s")
    
    all_flights = []
    flights_per_program = {}
    poll_count = 0
    max_polls = MAX_POLLING_TIME // POLLING_INTERVAL
    start_time = time.time()
    
    polling_body = {
        "task_id": task_id,
        "api_key": AWARD_TOOL_API_KEY,
    }
    
    for i in range(max_polls):
        poll_count += 1
        elapsed_time = time.time() - start_time
        
        print(f"  [FLIGHT POLLING] Poll #{poll_count} (elapsed: {elapsed_time:.1f}s)")
        
        try:
            response = requests.post(
                FLIGHT_POLLING_ENDPOINT,
                json=polling_body,
                headers={"Content-Type": "application/json"},
                timeout=15
            )
            
            if response.status_code == 200:
                data = response.json()
                
                new_flights = data.get("result", [])
                all_flights.extend(new_flights)
                
                # Count flights per program
                for flight in new_flights:
                    program_code = flight.get("program_code", "Unknown")
                    flights_per_program[program_code] = flights_per_program.get(program_code, 0) + 1
                
                finish = data.get("finish", False)
                programs_done = data.get("program_done", [])
                
                print(f"  [FLIGHT POLLING] New flights: {len(new_flights)}, Total: {len(all_flights)}")
                print(f"  [FLIGHT POLLING] Programs done: {programs_done}")
                print(f"  [FLIGHT POLLING] Finished: {finish}")
                
                if finish:
                    print(f"  [FLIGHT POLLING] ✓ Search completed!")
                    break
            else:
                print(f"  [FLIGHT POLLING] ✗ Failed: {response.status_code}")
                print(f"  [FLIGHT POLLING] Response: {response.text[:500]}")
                
        except requests.exceptions.Timeout:
            print(f"  [FLIGHT POLLING] ⚠ Timeout")
        except requests.exceptions.RequestException as e:
            print(f"  [FLIGHT POLLING] ✗ Error: {e}")
        except Exception as e:
            print(f"  [FLIGHT POLLING] ✗ Processing error: {e}")
        
        if i < max_polls - 1:
            time.sleep(POLLING_INTERVAL)
    
    print(f"\n  [FLIGHT POLLING] === SUMMARY ===")
    print(f"  [FLIGHT POLLING] Total polls: {poll_count}")
    print(f"  [FLIGHT POLLING] Total flights: {len(all_flights)}")
    print(f"  [FLIGHT POLLING] Total time: {time.time() - start_time:.1f}s")
    
    if flights_per_program:
        print(f"  [FLIGHT POLLING] Flights by program:")
        for prog in sorted(flights_per_program.keys()):
            print(f"    {prog}: {flights_per_program[prog]} flights")
    
    return all_flights, flights_per_program


def search_flights(origin: str, destination: str, date: str, 
                   program_lists: list = None, cabins: list = None):
    """
    Complete flight search: priming + polling.
    Returns list of flights.
    """
    program_lists = program_lists or AMEX_PROGRAM_LISTS
    cabins = cabins or ["Economy", "Business"]
    
    task_id = str(uuid.uuid4())
    
    # Phase 1: Priming
    success = send_flight_priming_request(
        task_id, origin, destination, date, program_lists, cabins
    )
    
    if not success:
        print("  [FLIGHT] ✗ Priming failed. No flights will be returned.")
        return [], {}
    
    # Phase 2: Polling
    flights, flights_per_program = poll_for_flight_results(task_id)
    
    return flights, flights_per_program


# =============================================================================
# HOTEL API FUNCTIONS
# =============================================================================

def fetch_hotel_calendar(hotel_id: str, date: str):
    """
    Fetch hotel calendar/availability from AwardTool API.
    Returns calendar data or error dict.
    """
    payload = {
        "hotel_id": hotel_id,
        "date": date,
        "api_key": AWARD_TOOL_API_KEY,
    }
    
    print(f"\n  [HOTEL] Fetching calendar for: {hotel_id}")
    print(f"  [HOTEL] Endpoint: {HOTEL_CALENDAR_ENDPOINT}")
    print(f"  [HOTEL] Date: {date}")
    
    try:
        response = requests.post(
            HOTEL_CALENDAR_ENDPOINT,
            json=payload,
            headers=HOTEL_HEADERS,
            timeout=30
        )
        
        print(f"  [HOTEL] Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            print(f"  [HOTEL] ✓ Success! Keys: {list(data.keys()) if isinstance(data, dict) else 'list'}")
            return data
        else:
            print(f"  [HOTEL] ✗ Failed: {response.text[:500]}")
            return {"error": f"HTTP {response.status_code}", "body": response.text}
            
    except requests.exceptions.Timeout:
        print(f"  [HOTEL] ✗ Timeout")
        return {"error": "timeout"}
    except requests.exceptions.RequestException as e:
        print(f"  [HOTEL] ✗ Request error: {e}")
        return {"error": str(e)}
    except Exception as e:
        print(f"  [HOTEL] ✗ Error: {e}")
        return {"error": str(e)}


def parse_hotel_calendar(calendar_data: dict, hotel_name: str):
    """
    Parse hotel calendar data into a list of availability entries.
    """
    if not isinstance(calendar_data, dict) or "error" in calendar_data:
        return []
    
    data = calendar_data.get("data", [])
    availability = []
    
    # Data structure: [{"2026-02-01": [{"points_rate": 30000, ...}], ...}]
    if isinstance(data, list) and len(data) > 0:
        date_dict = data[0] if isinstance(data[0], dict) else {}
        for date_str, rates in date_dict.items():
            if isinstance(rates, list):
                for rate in rates:
                    availability.append({
                        "hotel_name": hotel_name,
                        "date": date_str,
                        "points_rate": rate.get("points_rate"),
                        "cash_price": rate.get("cash_price"),
                        "point_value": rate.get("point_value"),
                        "room_type": rate.get("room_type"),
                        "rate_plan": rate.get("rate_plan"),
                        "booking_link": rate.get("res_link"),
                    })
    
    return availability


# =============================================================================
# MAIN TEST
# =============================================================================

def main():
    print(f"\n{'='*80}")
    print("  TEST: SEA -> CDG (Feb 11, 2026) - AMEX MEMBERSHIP REWARDS ONLY")
    print("  Using separate APIs for flights and hotels")
    print(f"{'='*80}")
    
    # ==========================================================================
    # TEST 1: FLIGHTS (using priming/polling API)
    # ==========================================================================
    print(f"\n{'='*80}")
    print("  SECTION 1: FLIGHT SEARCH")
    print(f"{'='*80}")
    print("  Route: SEA -> CDG")
    print("  Date: 2026-02-11")
    print("  Programs: Amex transfer partners only")
    print(f"  Program lists: {AMEX_PROGRAM_LISTS}")
    
    flights, flights_per_program = search_flights(
        origin="SEA",
        destination="CDG", 
        date="2026-02-11",
        program_lists=AMEX_PROGRAM_LISTS,
        cabins=["Economy", "Business"]
    )
    
    # Print flight results
    print(f"\n  === FLIGHT RESULTS ===")
    print(f"  Total flights found: {len(flights)}")
    
    if flights:
        # Group and display flights
        print(f"\n  Top 20 flights (sorted by points):")
        sorted_flights = sorted(flights, key=lambda x: x.get("award_points", float("inf")))[:20]
        
        for i, f in enumerate(sorted_flights, 1):
            prog = f.get("program_code", "?")
            points = f.get("award_points", "?")
            cabin = f.get("cabin_type", f.get("cabin", "?"))
            surcharge = f.get("surcharge", 0)
            
            # Get cabin_prices for tax if surcharge not at top level
            cabin_prices = f.get("cabin_prices", {})
            if cabin_prices and cabin in cabin_prices:
                surcharge = cabin_prices[cabin].get("tax", surcharge)
            
            # Get route from fare.products
            fare = f.get("fare", {})
            products = fare.get("products", []) if isinstance(fare, dict) else []
            
            if products:
                first_prod = products[0]
                last_prod = products[-1]
                route = f"{first_prod.get('origin', '?')} -> {last_prod.get('destination', '?')}"
                flight_nums = " / ".join([p.get("flight_number", "?") for p in products])
            else:
                route = "?"
                flight_nums = "?"
            
            print(f"    {i:2}. {points:>7,} {prog:>3} | {cabin:>12} | ${surcharge:>6.0f} tax | {route} | {flight_nums}")
    else:
        print("  No flights found.")
    
    # ==========================================================================
    # TEST 2: HOTELS (using hotel_calendar API)
    # ==========================================================================
    print(f"\n{'='*80}")
    print("  SECTION 2: HOTEL SEARCH")
    print(f"{'='*80}")
    print("  Location: Paris")
    print("  Date: 2026-02-11")
    print("  Programs: Amex transfer partners (Hilton, Marriott)")
    
    all_hotel_availability = []
    
    for hotel_info in SAMPLE_HOTELS:
        hotel_id = hotel_info["hotel_id"]
        hotel_name = hotel_info["name"]
        
        calendar_data = fetch_hotel_calendar(hotel_id, "2026-02-11")
        availability = parse_hotel_calendar(calendar_data, hotel_name)
        all_hotel_availability.extend(availability)
    
    # Print hotel results
    print(f"\n  === HOTEL RESULTS ===")
    print(f"  Total availability entries: {len(all_hotel_availability)}")
    
    if all_hotel_availability:
        # Group by hotel and show sample dates
        hotels_seen = {}
        for entry in all_hotel_availability:
            hotel_name = entry["hotel_name"]
            if hotel_name not in hotels_seen:
                hotels_seen[hotel_name] = []
            hotels_seen[hotel_name].append(entry)
        
        for hotel_name, entries in hotels_seen.items():
            print(f"\n  {hotel_name}:")
            # Show first 5 dates
            for entry in sorted(entries, key=lambda x: x["date"])[:5]:
                pts = entry.get("points_rate", "?")
                cash = entry.get("cash_price", "?")
                ppv = entry.get("point_value", "?")
                room = entry.get("room_type", "?")
                date = entry.get("date", "?")
                print(f"    {date}: {pts:,} pts (${cash} cash) | {ppv}cpp | {room}")
    else:
        print("  No hotel availability found.")
    
    # ==========================================================================
    # SUMMARY
    # ==========================================================================
    print(f"\n{'='*80}")
    print("  TEST COMPLETE")
    print(f"{'='*80}")
    print(f"  Flights found: {len(flights)}")
    print(f"  Hotel availability entries: {len(all_hotel_availability)}")
    print(f"{'='*80}\n")


if __name__ == "__main__":
    main()
