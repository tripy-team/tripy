#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Points Transfer Strategy Test Script - LIVE API VERSION (FLIGHTS ONLY)

This script uses the actual AwardTool API to fetch real flight data,
then generates specific transfer instructions.

Usage:
    python test_transfer_strategy_live.py

Requirements:
    pip install requests python-dotenv

Environment Variables:
    AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY - AwardTool API key

Example Output:
    Transfer 50,000 Amex points to Delta to book DL158 JFK->ICN on Mar 15
"""

import json
import os
import sys
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

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

if not AWARD_TOOL_API_KEY:
    print("WARNING: AWARD_TOOL_API_KEY not set. API calls may fail.")
    print("Set it with: export AWARD_TOOL_API_KEY=your_key_here")


# =============================================================================
# FLIGHT API CONFIGURATION
# =============================================================================

FLIGHT_PRIMING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_trigger/search_real_time"
FLIGHT_POLLING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_retrieval/search_result"

POLLING_INTERVAL = 5  # seconds
MAX_POLLING_TIME = 90  # seconds


# =============================================================================
# TRANSFER GRAPH (AIRLINES ONLY)
# =============================================================================

EXTENDED_TRANSFER_GRAPH = {
    "amex": {
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "NH": {"ratio": 1.0, "type": "airline", "name": "ANA Mileage Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
    },
    "chase": {
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France Flying Blue"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
    },
    "citi": {
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "QR": {"ratio": 1.0, "type": "airline", "name": "Qatar Privilege Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
    },
    "bilt": {
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France Flying Blue"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
    },
}

BANK_METADATA = {
    "amex": {
        "name": "American Express Membership Rewards",
        "short_name": "Amex",
        "portal_url": "https://global.americanexpress.com/rewards",
        "transfer_time": "1-2 business days",
    },
    "chase": {
        "name": "Chase Ultimate Rewards",
        "short_name": "Chase",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "transfer_time": "instant",
    },
    "citi": {
        "name": "Citi ThankYou Points",
        "short_name": "Citi",
        "portal_url": "https://thankyou.citi.com",
        "transfer_time": "instant to 24 hours",
    },
    "bilt": {
        "name": "Bilt Rewards",
        "short_name": "Bilt",
        "portal_url": "https://www.biltrewards.com",
        "transfer_time": "instant",
    },
}

PROGRAM_METADATA = {
    "UA": {"name": "United MileagePlus", "booking_url": "united.com"},
    "AA": {"name": "American AAdvantage", "booking_url": "aa.com"},
    "DL": {"name": "Delta SkyMiles", "booking_url": "delta.com"},
    "B6": {"name": "JetBlue TrueBlue", "booking_url": "jetblue.com"},
    "AS": {"name": "Alaska Mileage Plan", "booking_url": "alaskaair.com"},
    "AF": {"name": "Air France Flying Blue", "booking_url": "airfrance.com"},
    "BA": {"name": "British Airways Avios", "booking_url": "britishairways.com"},
    "SQ": {"name": "Singapore KrisFlyer", "booking_url": "singaporeair.com"},
    "CX": {"name": "Cathay Pacific Asia Miles", "booking_url": "cathaypacific.com"},
    "NH": {"name": "ANA Mileage Club", "booking_url": "ana.co.jp"},
    "EK": {"name": "Emirates Skywards", "booking_url": "emirates.com"},
    "TK": {"name": "Turkish Miles&Smiles", "booking_url": "turkishairlines.com"},
    "VS": {"name": "Virgin Atlantic Flying Club", "booking_url": "virginatlantic.com"},
    "AV": {"name": "Avianca LifeMiles", "booking_url": "lifemiles.com"},
    "IB": {"name": "Iberia Plus", "booking_url": "iberia.com"},
    "QR": {"name": "Qatar Privilege Club", "booking_url": "qatarairways.com"},
}

# Default award programs for AwardTool (airlines only)
AIRLINE_PROGRAMS = ["UA", "AA", "DL", "AS", "B6", "AF", "BA", "SQ", "NH", "EK", "VS", "AV"]


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class FlightOption:
    """A flight option from the API."""
    flight_number: str
    origin: str
    destination: str
    departure_time: str
    arrival_time: str
    airline_code: str
    cash_cost: Optional[float] = None
    points_cost: Optional[int] = None
    points_program: Optional[str] = None
    surcharge: Optional[float] = None
    transfer_partners: List[Dict] = field(default_factory=list)
    cabin: str = "Economy"


@dataclass
class TransferAction:
    """A specific transfer action to take."""
    bank: str
    bank_name: str
    program: str
    program_name: str
    points_amount: int
    ratio: float
    resulting_points: int
    transfer_time: str
    for_booking: str  # e.g., "DL158 JFK->ICN on Mar 15"


@dataclass
class BookingAction:
    """A specific booking action to take."""
    booking_type: str  # "flight"
    description: str  # e.g., "DL158 JFK->ICN"
    payment_method: str  # "points" or "cash"
    points_program: Optional[str] = None
    points_amount: Optional[int] = None
    cash_amount: float = 0.0
    surcharge: float = 0.0
    booking_url: str = ""


# =============================================================================
# FLIGHT API FUNCTIONS
# =============================================================================

def send_flight_priming_request(task_id: str, origin: str, destination: str, date: str, 
                                 program_lists: list, cabins: list = None):
    """Send priming requests to initiate flight search."""
    cabins = cabins or ["Economy", "Business"]
    
    print(f"\n  [PRIMING] Starting search for {origin} -> {destination} on {date}")
    print(f"  [PRIMING] Task ID: {task_id}")
    
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
        
        print(f"  [PRIMING] Sending for programs: {program_list}")
        
        try:
            response = requests.post(
                FLIGHT_PRIMING_ENDPOINT,
                json=request_body,
                headers=headers,
                timeout=15
            )
            
            if response.status_code == 200:
                print(f"  [PRIMING] ✓ Success for {program_list}")
                success_count += 1
            else:
                print(f"  [PRIMING] ✗ Failed for {program_list}: {response.status_code}")
                
        except requests.exceptions.Timeout:
            print(f"  [PRIMING] ✗ Timeout for {program_list}")
        except requests.exceptions.RequestException as e:
            print(f"  [PRIMING] ✗ Error for {program_list}: {e}")
    
    return success_count > 0


def poll_for_flight_results(task_id: str):
    """Poll for flight results until search completes or timeout."""
    print(f"\n  [POLLING] Starting polling phase")
    
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
        
        print(f"  [POLLING] Poll #{poll_count} (elapsed: {elapsed_time:.1f}s)")
        
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
                
                for flight in new_flights:
                    program_code = flight.get("program_code", "Unknown")
                    flights_per_program[program_code] = flights_per_program.get(program_code, 0) + 1
                
                finish = data.get("finish", False)
                
                print(f"  [POLLING] New flights: {len(new_flights)}, Total: {len(all_flights)}, Finished: {finish}")
                
                if finish:
                    print(f"  [POLLING] ✓ Search completed!")
                    break
            else:
                print(f"  [POLLING] ✗ Failed: {response.status_code}")
                
        except Exception as e:
            print(f"  [POLLING] ✗ Error: {e}")
        
        if i < max_polls - 1:
            time.sleep(POLLING_INTERVAL)
    
    print(f"\n  [POLLING] === SUMMARY ===")
    print(f"  Total flights: {len(all_flights)}")
    print(f"  Time: {time.time() - start_time:.1f}s")
    
    return all_flights, flights_per_program


def search_flights(origin: str, destination: str, date: str, 
                   program_lists: list = None, cabins: list = None):
    """Complete flight search: priming + polling."""
    # Default to Amex transfer partners
    program_lists = program_lists or [
        ["DL", "B6", "AS"],
        ["AF", "BA", "VS"],
        ["SQ", "CX", "EK", "AV"],
    ]
    cabins = cabins or ["Economy", "Business"]
    
    task_id = str(uuid.uuid4())
    
    success = send_flight_priming_request(
        task_id, origin, destination, date, program_lists, cabins
    )
    
    if not success:
        print("  [FLIGHT] ✗ Priming failed.")
        return [], {}
    
    flights, flights_per_program = poll_for_flight_results(task_id)
    
    return flights, flights_per_program


def parse_flight_results(raw_flights: List[Dict]) -> List[FlightOption]:
    """Parse raw API flight results into FlightOption objects."""
    flights = []
    
    for item in raw_flights:
        points = item.get("award_points", 0)
        prog = item.get("program_code", "").upper()
        cabin = item.get("cabin_type", "Economy")
        
        # Get tax from cabin_prices
        cabin_prices = item.get("cabin_prices", {})
        surcharge = 0
        if cabin in cabin_prices:
            surcharge = cabin_prices[cabin].get("tax", 0)
        
        # Get flight info from fare.products
        fare = item.get("fare", {})
        products = fare.get("products", []) if isinstance(fare, dict) else []
        
        if products:
            first_prod = products[0]
            last_prod = products[-1]
            origin = first_prod.get("origin", "")
            destination = last_prod.get("destination", "")
            flight_nums = " / ".join([p.get("flight_number", "") for p in products])
            dep_time = first_prod.get("departure_time", "")
            arr_time = last_prod.get("arrival_time", "")
            airline = first_prod.get("airline_code", "")
        else:
            origin = ""
            destination = ""
            flight_nums = ""
            dep_time = ""
            arr_time = ""
            airline = ""
        
        if points and prog:
            flights.append(FlightOption(
                flight_number=flight_nums,
                origin=origin,
                destination=destination,
                departure_time=dep_time,
                arrival_time=arr_time,
                airline_code=airline,
                points_cost=int(points),
                points_program=prog,
                surcharge=float(surcharge),
                cabin=cabin,
            ))
    
    return flights


# =============================================================================
# TRANSFER STRATEGY GENERATOR
# =============================================================================

def find_best_transfer_source(
    program: str,
    points_needed: int,
    available_points: Dict[str, int],
) -> Optional[Tuple[str, int, float]]:
    """Find the best bank to transfer from for a given program."""
    best = None
    
    for bank, transfers in EXTENDED_TRANSFER_GRAPH.items():
        if program not in transfers:
            continue
        
        balance = available_points.get(bank, 0)
        if balance <= 0:
            continue
        
        ratio = transfers[program]["ratio"]
        bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
        
        if balance >= bank_points_needed:
            if best is None or ratio > best[2]:
                best = (bank, bank_points_needed, ratio)
    
    return best


def generate_transfer_strategy(
    flights: List[FlightOption],
    available_points: Dict[str, int],
    selected_flights: List[str] = None,
) -> Tuple[List[TransferAction], List[BookingAction], Dict]:
    """Generate a complete transfer strategy for selected flight bookings."""
    transfers = []
    bookings = []
    points_used = {}
    
    remaining_points = dict(available_points)
    
    flight_map = {f.flight_number: f for f in flights}
    selected_flights = selected_flights or [f.flight_number for f in flights if f.points_cost]
    
    for fn in selected_flights:
        flight = flight_map.get(fn)
        if not flight:
            continue
        
        if flight.points_cost and flight.points_program:
            program = flight.points_program
            points_needed = flight.points_cost
            
            source = find_best_transfer_source(program, points_needed, remaining_points)
            
            if source:
                bank, bank_pts, ratio = source
                resulting_pts = int(bank_pts * ratio)
                
                bank_info = BANK_METADATA.get(bank, {})
                prog_info = EXTENDED_TRANSFER_GRAPH.get(bank, {}).get(program, {})
                
                booking_desc = f"{flight.flight_number} {flight.origin}->{flight.destination}"
                if flight.departure_time:
                    booking_desc += f" ({flight.departure_time})"
                
                transfers.append(TransferAction(
                    bank=bank,
                    bank_name=bank_info.get("short_name", bank.title()),
                    program=program,
                    program_name=prog_info.get("name", program),
                    points_amount=bank_pts,
                    ratio=ratio,
                    resulting_points=resulting_pts,
                    transfer_time=bank_info.get("transfer_time", "varies"),
                    for_booking=booking_desc,
                ))
                
                remaining_points[bank] = remaining_points.get(bank, 0) - bank_pts
                points_used[program] = points_used.get(program, 0) + points_needed
                
                prog_meta = PROGRAM_METADATA.get(program, {})
                bookings.append(BookingAction(
                    booking_type="flight",
                    description=f"{flight.flight_number} {flight.origin} -> {flight.destination}",
                    payment_method="points",
                    points_program=program,
                    points_amount=points_needed,
                    surcharge=flight.surcharge or 0,
                    booking_url=prog_meta.get("booking_url", ""),
                ))
            else:
                bookings.append(BookingAction(
                    booking_type="flight",
                    description=f"{flight.flight_number} {flight.origin} -> {flight.destination}",
                    payment_method="cash",
                    cash_amount=flight.cash_cost or 0,
                ))
    
    total_oop = sum(b.surcharge + b.cash_amount for b in bookings)
    total_cash_alternative = sum(
        (flight_map.get(fn).cash_cost or 0) for fn in selected_flights if fn in flight_map
    )
    
    summary = {
        "total_out_of_pocket": total_oop,
        "total_cash_alternative": total_cash_alternative,
        "savings": total_cash_alternative - total_oop,
        "points_used": points_used,
        "remaining_points": remaining_points,
    }
    
    return transfers, bookings, summary


# =============================================================================
# PRETTY PRINT
# =============================================================================

def print_divider(char="=", width=80):
    print(char * width)


def print_header(title):
    print()
    print_divider()
    print(f"  {title}")
    print_divider()


def print_strategy(transfers: List[TransferAction], bookings: List[BookingAction], summary: Dict):
    """Print the transfer strategy in a readable format."""
    
    print_header("POINTS TRANSFER STRATEGY (FLIGHTS ONLY)")
    
    print()
    print(f"  TOTAL OUT-OF-POCKET: ${summary['total_out_of_pocket']:,.2f}")
    print(f"  vs. All Cash:        ${summary['total_cash_alternative']:,.2f}")
    print(f"  YOU SAVE:            ${summary['savings']:,.2f}")
    print()
    
    if transfers:
        print_divider("-")
        print("  STEP 1: TRANSFER YOUR POINTS")
        print_divider("-")
        print()
        
        for i, t in enumerate(transfers, 1):
            ratio_str = f"1:{int(t.ratio)}" if t.ratio >= 1 else "1:1"
            print(f"  {i}. Transfer {t.points_amount:,} {t.bank_name} points to {t.program_name}")
            print(f"     -> Receive {t.resulting_points:,} {t.program_name} points ({ratio_str})")
            print(f"     -> Transfer time: {t.transfer_time}")
            print(f"     -> For: {t.for_booking}")
            print()
    
    print_divider("-")
    print("  STEP 2: BOOK YOUR FLIGHTS")
    print_divider("-")
    print()
    
    for b in bookings:
        if b.payment_method == "points":
            prog_name = PROGRAM_METADATA.get(b.points_program, {}).get("name", b.points_program)
            print(f"  [FLIGHT] {b.description}")
            print(f"     Pay: {b.points_amount:,} {prog_name} points + ${b.surcharge:.2f} taxes")
            if b.booking_url:
                print(f"     Book at: {b.booking_url}")
        else:
            print(f"  [CASH] {b.description}")
            print(f"     Pay: ${b.cash_amount:,.2f} cash")
        print()
    
    print_divider("-")
    print("  REMAINING POINTS AFTER TRANSFERS")
    print_divider("-")
    print()
    
    for prog, balance in summary["remaining_points"].items():
        if balance > 0:
            name = BANK_METADATA.get(prog, {}).get("name", prog.title())
            print(f"  * {name}: {balance:,} points")
    
    print()
    print_divider()


# =============================================================================
# MAIN
# =============================================================================

def main():
    print()
    print_divider("=")
    print("  TRIPY POINTS TRANSFER STRATEGY - FLIGHTS ONLY")
    print("  Fetches real flight data and generates specific transfer instructions")
    print_divider("=")
    
    if not AWARD_TOOL_API_KEY:
        print()
        print("  ERROR: No API key found. Set AWARD_TOOL_API_KEY environment variable.")
        return
    
    # Example: Search SEA -> CDG
    print_header("FLIGHT SEARCH: SEA -> CDG (Feb 11, 2026)")
    print("  Using Amex Membership Rewards transfer partners")
    
    raw_flights, flights_per_program = search_flights(
        origin="SEA",
        destination="CDG",
        date="2026-02-11",
        program_lists=[
            ["DL", "B6", "AS"],
            ["AF", "BA", "VS"],
            ["SQ", "CX", "EK", "AV"],
        ],
        cabins=["Economy", "Business"]
    )
    
    if not raw_flights:
        print("  No flights found.")
        return
    
    flights = parse_flight_results(raw_flights)
    
    print(f"\n  Found {len(flights)} flight options")
    print("\n  Top 10 flights (by points):")
    
    sorted_flights = sorted(flights, key=lambda x: x.points_cost or float("inf"))[:10]
    for i, f in enumerate(sorted_flights, 1):
        print(f"    {i:2}. {f.points_cost:>7,} {f.points_program:>3} | {f.cabin:>12} | ${f.surcharge:>6.0f} tax | {f.origin}->{f.destination} | {f.flight_number}")
    
    # Generate transfer strategy for best option
    if sorted_flights:
        print_header("TRANSFER STRATEGY FOR BEST FLIGHT")
        
        available_points = {"amex": 200000}
        
        best_flight = sorted_flights[0]
        
        transfers, bookings, summary = generate_transfer_strategy(
            flights, available_points, [best_flight.flight_number]
        )
        
        print_strategy(transfers, bookings, summary)
    
    print()
    print_divider("=")
    print("  COMPLETE")
    print_divider("=")
    print()


if __name__ == "__main__":
    main()
