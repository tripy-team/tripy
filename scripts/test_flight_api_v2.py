#!/usr/bin/env python3
"""
Script to send a priming request to the Award Flight Search API v2
for JFK to LHR in business class.

This script demonstrates a two-phase API interaction:
1. Priming Phase: Initiates an award flight search by sending a search request
2. Polling Phase: Periodically checks for results until the search completes

API Documentation: https://documenter.getpostman.com/view/31698313/2s9Ykhfj6S

TESTED AND WORKING as of January 2026.
"""

import requests
import json
import uuid
import time
from datetime import datetime
from loguru import logger

# ============================================================================
# API Configuration
# ============================================================================

# Endpoint for initiating the award flight search (priming request)
# This starts an asynchronous search process on the server
PRIMING_ENDPOINT = 'https://apisv2.awardtoolapi.com/flight_trigger/search_real_time'

# Endpoint for checking search progress and retrieving results
# Used during the polling phase to get incremental results
POLLING_ENDPOINT = 'https://apisv2.awardtoolapi.com/flight_retrieval/search_result'

# API authentication key required for both endpoints
API_KEY = "0363cfd0-ba6a-4302-ba14-9f86186eb0c7"

# ============================================================================
# Polling Configuration
# ============================================================================

# Time to wait between polling requests (in seconds)
POLLING_INTERVAL = 5  # seconds

# Maximum total time to spend polling (in seconds)
MAX_POLLING_TIME = 60  # seconds

# ============================================================================
# Request Configuration
# ============================================================================

# Search parameters for the award flight search
request_body = {
    "date": "2026-02-06",           # Travel date in YYYY-MM-DD format
    "origin": "JFK",                 # Origin airport code
    "destination": "LHR",            # Destination airport code
    "pax": 1,                        # Number of passengers
    # Cabin classes to search for
    "cabins": ["Economy", "Premium Economy", "Business", "First"],
    "api_key": API_KEY,
    # Exit immediately and retrieve data with polling API
    "exit_early": True
}

# Program batches - split into groups for parallel priming
# Each batch is sent as a separate priming request
PROGRAM_BATCHES = [
    ["QF", "AC", "UA"],   # Qantas, Air Canada, United
    ["AA", "AS", "AV"],   # American, Alaska, Avianca
    ["B6", "VA", "VS"],   # JetBlue, Virgin Australia, Virgin Atlantic
]

# ============================================================================
# Supported Airline Programs
# ============================================================================
# American Airlines AAdvantage (AA)
# Air Canada Aeroplan (AC)
# Aeromexico Club Premier (AM)
# Alaska Atmos Rewards (AS)
# Avianca LifeMiles (AV)
# JetBlue True Blue (B6)
# British Airways Executive Club (BA)
# Cathay Pacific Asia Miles (CX)
# Lufthansa Miles & More (LH)
# Qatar Airways Privilege Club (QR)
# Finnair Plus (AY)
# GOL Smiles (G3)
# Delta SkyMiles (DL)
# Emirates Skywards (EK)
# Etihad Guest (EY)
# Air France/KLM Flying Blue (KL)
# Qantas Frequent Flyer (QF)
# Singapore KrisFlyer (SQ)
# SAS EuroBonus (SK)
# TAP Air Portugal Miles&Go (TP)
# Turkish Miles & Smiles (TK)
# United MileagePlus (UA)
# Virgin Australia Velocity (VA)
# Virgin Atlantic Flying Club (VS)

# HTTP headers for API requests
headers = {
    "Content-Type": "application/json"
}


def send_priming_request(task_id):
    """
    Send priming requests to AwardTool API to initiate the search.

    Programs are batched and sent in parallel for efficiency.
    
    Returns:
        int: Number of successfully primed batches
    """
    logger.info("=" * 60)
    logger.info("AwardTool Flight API v2 - Priming Phase")
    logger.info("=" * 60)
    logger.info(f"Endpoint: {PRIMING_ENDPOINT}")
    logger.info(f"Task ID: {task_id}")
    logger.info(f"Route: {request_body['origin']} -> {request_body['destination']}")
    logger.info(f"Date: {request_body['date']}")
    logger.info(f"Cabins: {request_body['cabins']}")
    logger.info("=" * 60)

    success_count = 0
    
    for batch_num, programs in enumerate(PROGRAM_BATCHES, 1):
        payload = {
            **request_body,
            "task_id": task_id,
            "programs": programs,
        }
        
        logger.info(f"Batch {batch_num}/{len(PROGRAM_BATCHES)}: {programs}")
        
        try:
            response = requests.post(
                PRIMING_ENDPOINT,
                json=payload,
                headers=headers,
                timeout=15
            )
            
            if response.status_code == 200:
                logger.success(f"  Priming successful!")
                success_count += 1
            else:
                logger.error(f"  Failed: {response.status_code} - {response.text[:200]}")
                
        except requests.exceptions.Timeout:
            logger.error(f"  Timeout after 15 seconds")
        except requests.exceptions.RequestException as e:
            logger.error(f"  Request error: {e}")
    
    logger.info(f"\nPriming complete: {success_count}/{len(PROGRAM_BATCHES)} batches succeeded")
    return success_count


def write_results_to_file(filename, data):
    """Write results data to a JSON file."""
    with open(filename, 'w') as f:
        json.dump(data, f, indent=2)
    logger.info(f"Saved results to: {filename}")


def poll_for_results(task_id):
    """
    Poll the API for flight results until search completes or timeout.
    
    Returns accumulated flights with deduplication.
    """
    logger.info("=" * 60)
    logger.info("AwardTool Flight API v2 - Polling Phase")
    logger.info("=" * 60)

    all_flights = []
    flights_seen = set()  # For deduplication
    flights_per_program = {}
    final_programs_done = []
    
    poll_count = 0
    max_polls = MAX_POLLING_TIME // POLLING_INTERVAL
    start_time = time.time()

    polling_payload = {
        "task_id": task_id,
        "api_key": API_KEY,
    }

    for i in range(max_polls):
        poll_count += 1
        elapsed_time = time.time() - start_time
        
        logger.info(f"[Poll #{poll_count}] Elapsed: {elapsed_time:.1f}s")

        try:
            response = requests.post(
                POLLING_ENDPOINT,
                json=polling_payload,
                headers=headers,
                timeout=15
            )

            if response.status_code == 200:
                data = response.json()
                
                # Extract new flights (API returns incremental results)
                new_flights = data.get("result", [])
                
                # Deduplicate
                added_count = 0
                for flight in new_flights:
                    # Create unique key for deduplication
                    flight_key = (
                        f"{flight.get('origin', '')}:"
                        f"{flight.get('destination', '')}:"
                        f"{flight.get('program_code', '')}:"
                        f"{flight.get('award_points', '')}:"
                        f"{flight.get('flight_number', '')}:"
                        f"{flight.get('cabin_type', '')}"
                    )
                    if flight_key not in flights_seen:
                        flights_seen.add(flight_key)
                        all_flights.append(flight)
                        added_count += 1
                        
                        # Track per program
                        prog = flight.get("program_code", "Unknown")
                        flights_per_program[prog] = flights_per_program.get(prog, 0) + 1

                finished = data.get("finish", False)
                programs_done = data.get("program_done", [])
                final_programs_done = programs_done.copy() if programs_done else []
                missing_keys = data.get("missing_keys", [])

                logger.info(f"  New flights: {len(new_flights)} (added: {added_count})")
                logger.info(f"  Total flights: {len(all_flights)}")
                logger.info(f"  Programs done: {len(programs_done)}")
                logger.info(f"  Finished: {finished}")

                # Save intermediate results
                write_results_to_file(f"flight_poll_{poll_count}.json", {
                    "poll_number": poll_count,
                    "timestamp": datetime.now().isoformat(),
                    "elapsed_time": elapsed_time,
                    "flights_in_poll": len(new_flights),
                    "total_flights": len(all_flights),
                    "programs_done": programs_done,
                    "finished": finished,
                    "all_flights": all_flights,
                })

                if finished:
                    logger.success(f"Search completed! Found {len(all_flights)} total flights.")
                    break
            else:
                logger.error(f"  Poll failed: {response.status_code}")

        except requests.exceptions.Timeout:
            logger.warning("  Poll timeout")
        except requests.exceptions.RequestException as e:
            logger.error(f"  Poll error: {e}")
        except Exception as e:
            logger.error(f"  Processing error: {e}")

        if i < max_polls - 1:
            time.sleep(POLLING_INTERVAL)

    # Final summary
    logger.info("=" * 60)
    logger.info("Polling Complete")
    logger.info("=" * 60)
    logger.info(f"Total polls: {poll_count}")
    logger.info(f"Total flights: {len(all_flights)}")
    logger.info(f"Total time: {time.time() - start_time:.1f}s")
    
    logger.info("\nFlights by Program:")
    for prog in sorted(flights_per_program.keys()):
        logger.info(f"  {prog}: {flights_per_program[prog]} flight(s)")

    # Write final results
    write_results_to_file("flight_final_results.json", {
        "task_id": task_id,
        "route": f"{request_body['origin']}-{request_body['destination']}",
        "date": request_body["date"],
        "total_polls": poll_count,
        "total_flights": len(all_flights),
        "programs_finished": final_programs_done,
        "flights_per_program": flights_per_program,
        "flights": all_flights,
    })


if __name__ == "__main__":
    # Generate unique task ID (billing is based on unique task_id)
    task_id = str(uuid.uuid4())
    logger.info(f"Generated Task ID: {task_id}")

    # Phase 1: Prime the search
    success = send_priming_request(task_id)

    if success > 0:
        # Brief delay to allow server processing
        logger.info("\nWaiting 2 seconds before polling...")
        time.sleep(2)
        
        # Phase 2: Poll for results
        poll_for_results(task_id)
    else:
        logger.error("All priming requests failed. Exiting.")
        exit(1)
