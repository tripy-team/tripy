#!/usr/bin/env python3
"""
Custom test for SEA -> CDG on Feb 11, 2026 with Amex Membership Rewards only.
NO MOCK DATA - Shows actual API responses and errors.

Uses the AwardTool Flight API (priming + polling approach).
"""

import json
import os
import sys
import time
import uuid

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
# MAIN TEST
# =============================================================================

def main():
    print(f"\n{'='*80}")
    print("  TEST: SEA -> CDG (Feb 11, 2026) - AMEX MEMBERSHIP REWARDS ONLY")
    print("  Flight search using AwardTool API")
    print(f"{'='*80}")
    
    # ==========================================================================
    # FLIGHT SEARCH
    # ==========================================================================
    print(f"\n{'='*80}")
    print("  FLIGHT SEARCH")
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
    # SUMMARY
    # ==========================================================================
    print(f"\n{'='*80}")
    print("  TEST COMPLETE")
    print(f"{'='*80}")
    print(f"  Flights found: {len(flights)}")
    print(f"{'='*80}\n")


if __name__ == "__main__":
    main()
