#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Points Transfer Strategy Test Script - LIVE API VERSION

This script uses SerpAPI (Google Flights) for cash prices and AwardTool for
award flight information to generate specific transfer instructions like:
  "Transfer 50,000 Amex points to Delta to book DL158 JFK->ICN"

Usage:
    python test_transfer_strategy_mock.py

Requirements:
    pip install httpx python-dotenv serpapi

Environment Variables:
    AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY - AwardTool API key
    SERPAPI_KEY or SERP_API_KEY - SerpAPI key for Google Flights
"""

import asyncio
import os
import re
import random
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

try:
    import httpx
except ImportError:
    print("Error: httpx package required. Install with: pip install httpx")
    import sys
    sys.exit(1)

try:
    from serpapi import GoogleSearch
except ImportError:
    print("Error: serpapi package required. Install with: pip install google-search-results")
    import sys
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Warning: python-dotenv not installed. Using environment variables directly.")


# =============================================================================
# API CONFIGURATION
# =============================================================================

AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
SERPAPI_KEY = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")

if not AWARD_TOOL_API_KEY:
    print("WARNING: AWARD_TOOL_API_KEY not set. Award flight data will be unavailable.")
    print("Set it with: export AWARD_TOOL_API_KEY=your_key_here")

if not SERPAPI_KEY:
    print("WARNING: SERPAPI_KEY not set. Cash flight prices will be unavailable.")
    print("Set it with: export SERPAPI_KEY=your_key_here")

TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=20)
AWARDTOOL_URL = "https://www.awardtool-api.com/search_real_time"


# =============================================================================
# TRANSFER GRAPH
# =============================================================================

TRANSFER_GRAPH = {
    "amex": {
        "DL": {"ratio": 1.0, "name": "Delta SkyMiles"},
        "B6": {"ratio": 1.0, "name": "JetBlue TrueBlue"},
        "AF": {"ratio": 1.0, "name": "Air France Flying Blue"},
        "BA": {"ratio": 1.0, "name": "British Airways Avios"},
        "SQ": {"ratio": 1.0, "name": "Singapore KrisFlyer"},
        "NH": {"ratio": 1.0, "name": "ANA Mileage Club"},
        "VS": {"ratio": 1.0, "name": "Virgin Atlantic Flying Club"},
        "CX": {"ratio": 1.0, "name": "Cathay Pacific Asia Miles"},
        "EK": {"ratio": 1.0, "name": "Emirates Skywards"},
        "AV": {"ratio": 1.0, "name": "Avianca LifeMiles"},
        "AS": {"ratio": 1.0, "name": "Alaska Mileage Plan"},
        "HH": {"ratio": 2.0, "name": "Hilton Honors"},
        "MAR": {"ratio": 1.0, "name": "Marriott Bonvoy"},
    },
    "chase": {
        "UA": {"ratio": 1.0, "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "name": "Air France Flying Blue"},
        "IB": {"ratio": 1.0, "name": "Iberia Plus"},
        "VS": {"ratio": 1.0, "name": "Virgin Atlantic Flying Club"},
        "SQ": {"ratio": 1.0, "name": "Singapore KrisFlyer"},
        "AS": {"ratio": 1.0, "name": "Alaska Mileage Plan"},
        "HYATT": {"ratio": 1.0, "name": "World of Hyatt"},
        "MAR": {"ratio": 1.0, "name": "Marriott Bonvoy"},
        "IHG": {"ratio": 1.0, "name": "IHG One Rewards"},
    },
    "citi": {
        "AA": {"ratio": 1.0, "name": "American AAdvantage"},
        "TK": {"ratio": 1.0, "name": "Turkish Miles&Smiles"},
        "SQ": {"ratio": 1.0, "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "name": "Cathay Pacific Asia Miles"},
        "QR": {"ratio": 1.0, "name": "Qatar Privilege Club"},
        "EK": {"ratio": 1.0, "name": "Emirates Skywards"},
        "VS": {"ratio": 1.0, "name": "Virgin Atlantic Flying Club"},
        "AV": {"ratio": 1.0, "name": "Avianca LifeMiles"},
    },
    "bilt": {
        "UA": {"ratio": 1.0, "name": "United MileagePlus"},
        "AA": {"ratio": 1.0, "name": "American AAdvantage"},
        "AF": {"ratio": 1.0, "name": "Air France Flying Blue"},
        "TK": {"ratio": 1.0, "name": "Turkish Miles&Smiles"},
        "VS": {"ratio": 1.0, "name": "Virgin Atlantic Flying Club"},
        "HYATT": {"ratio": 1.0, "name": "World of Hyatt"},
        "IHG": {"ratio": 1.0, "name": "IHG One Rewards"},
    },
}

BANK_INFO = {
    "amex": {"name": "Amex Membership Rewards", "short": "Amex", "time": "1-2 business days"},
    "chase": {"name": "Chase Ultimate Rewards", "short": "Chase", "time": "instant"},
    "citi": {"name": "Citi ThankYou Points", "short": "Citi", "time": "instant to 24h"},
    "bilt": {"name": "Bilt Rewards", "short": "Bilt", "time": "instant"},
}

PROGRAM_INFO = {
    "UA": {"name": "United MileagePlus", "url": "united.com"},
    "AA": {"name": "American AAdvantage", "url": "aa.com"},
    "DL": {"name": "Delta SkyMiles", "url": "delta.com"},
    "B6": {"name": "JetBlue TrueBlue", "url": "jetblue.com"},
    "AS": {"name": "Alaska Mileage Plan", "url": "alaskaair.com"},
    "AF": {"name": "Air France Flying Blue", "url": "airfrance.com"},
    "BA": {"name": "British Airways Avios", "url": "britishairways.com"},
    "SQ": {"name": "Singapore KrisFlyer", "url": "singaporeair.com"},
    "CX": {"name": "Cathay Pacific Asia Miles", "url": "cathaypacific.com"},
    "NH": {"name": "ANA Mileage Club", "url": "ana.co.jp"},
    "EK": {"name": "Emirates Skywards", "url": "emirates.com"},
    "VS": {"name": "Virgin Atlantic", "url": "virginatlantic.com"},
    "IB": {"name": "Iberia Plus", "url": "iberia.com"},
    "TK": {"name": "Turkish Miles&Smiles", "url": "turkishairlines.com"},
    "QR": {"name": "Qatar Privilege Club", "url": "qatarairways.com"},
    "AV": {"name": "Avianca LifeMiles", "url": "lifemiles.com"},
    "HH": {"name": "Hilton Honors", "url": "hilton.com"},
    "MAR": {"name": "Marriott Bonvoy", "url": "marriott.com"},
    "HYATT": {"name": "World of Hyatt", "url": "hyatt.com"},
    "IHG": {"name": "IHG One Rewards", "url": "ihg.com"},
}

# Default award programs to search
AIRLINE_PROGRAMS = ["UA", "AA", "DL", "AS", "B6", "AF", "BA", "SQ", "NH", "EK", "VS", "AV"]


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class Flight:
    flight_number: str
    origin: str
    destination: str
    date: str
    departure_time: str
    arrival_time: str
    cash_cost: Optional[float]
    points_cost: Optional[int]
    points_program: Optional[str]
    surcharge: float
    cabin: str = "Economy"


@dataclass
class Hotel:
    name: str
    location: str
    check_in: str
    check_out: str
    nights: int
    cash_cost: float
    points_cost: int
    points_program: str
    surcharge: float


@dataclass  
class TransferAction:
    bank: str
    bank_short: str
    program: str
    program_name: str
    points_to_transfer: int
    resulting_points: int
    ratio: float
    transfer_time: str
    for_booking: str


@dataclass
class BookingAction:
    booking_type: str
    description: str
    payment_method: str
    points_program: Optional[str] = None
    points_amount: int = 0
    surcharge: float = 0.0
    cash_amount: float = 0.0


# =============================================================================
# UTILITY FUNCTIONS
# =============================================================================

def _to_number(v) -> Optional[float]:
    """Convert various price formats to float."""
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"(\d[\d,\.]*)", str(v))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except:
        return None


def _normalize_flightnum(x: str) -> str:
    """Normalize flight number to uppercase without spaces."""
    return re.sub(r"\s+", "", str(x or "").strip().upper())


def get_random_future_date(days_ahead_min=14, days_ahead_max=90) -> str:
    """Get a random date in the future for testing."""
    days = random.randint(days_ahead_min, days_ahead_max)
    future_date = datetime.now() + timedelta(days=days)
    return future_date.strftime("%Y-%m-%d")


# =============================================================================
# SERPAPI - GOOGLE FLIGHTS (CASH PRICES)
# =============================================================================

def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    travel_class: int = 1,  # 1=Economy, 2=Premium Economy, 3=Business, 4=First
) -> List[Dict[str, Any]]:
    """
    Fetch cash flight prices from SerpAPI Google Flights.
    Returns list of flight options with prices.
    """
    if not SERPAPI_KEY:
        print(f"  [!] No SERPAPI_KEY - cannot fetch cash prices for {origin}->{destination}")
        return []
    
    params = {
        "engine": "google_flights",
        "departure_id": origin.upper(),
        "arrival_id": destination.upper(),
        "outbound_date": outbound_date,
        "type": "2",  # One-way
        "currency": "USD",
        "hl": "en",
        "api_key": SERPAPI_KEY,
    }
    if travel_class in (1, 2, 3, 4):
        params["travel_class"] = str(travel_class)
    
    print(f"  [SerpAPI] Fetching cash prices {origin}->{destination} on {outbound_date}...")
    
    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        best = data.get("best_flights") or []
        other = data.get("other_flights") or []
        results = list(best) + list(other)
        print(f"  [SerpAPI] Found {len(results)} flight options")
        return results
    except Exception as e:
        print(f"  [!] SerpAPI error: {e}")
        return []


def extract_flights_from_serp(serp_data: List[Dict], date: str) -> Dict[str, Dict]:
    """
    Extract flight info from SerpAPI response.
    Returns dict keyed by (origin, destination, flight_number) with cash prices.
    """
    flights_by_key = {}
    
    for option in serp_data:
        price = _to_number(option.get("price"))
        flights = option.get("flights") or []
        
        for leg in flights:
            dep_airport = leg.get("departure_airport", {})
            arr_airport = leg.get("arrival_airport", {})
            
            origin = dep_airport.get("id", "").upper()
            destination = arr_airport.get("id", "").upper()
            flight_num = _normalize_flightnum(leg.get("flight_number"))
            dep_time = dep_airport.get("time", "")
            arr_time = arr_airport.get("time", "")
            airline = (leg.get("airline") or "").strip()
            
            if not origin or not destination or not flight_num:
                continue
            
            key = (origin, destination, flight_num)
            existing = flights_by_key.get(key)
            
            # Keep the cheapest price
            if existing is None or (price and (existing.get("cash_cost") is None or price < existing["cash_cost"])):
                flights_by_key[key] = {
                    "flight_number": flight_num,
                    "origin": origin,
                    "destination": destination,
                    "date": date,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                    "cash_cost": price,
                    "airline": airline,
                }
    
    return flights_by_key


# =============================================================================
# AWARDTOOL - AWARD FLIGHTS (POINTS)
# =============================================================================

async def fetch_awardtool_flights(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str] = None,
    programs: List[str] = None,
    pax: int = 1,
) -> List[Dict]:
    """
    Fetch award flight availability from AwardTool API.
    Returns list of award flight options with points and surcharges.
    """
    if not AWARD_TOOL_API_KEY:
        print(f"  [!] No AWARD_TOOL_API_KEY - cannot fetch award flights for {origin}->{destination}")
        return []
    
    cabins = cabins or ["Economy", "Business"]
    programs = programs or AIRLINE_PROGRAMS
    
    payload = {
        "origin": origin.upper(),
        "destination": destination.upper(),
        "programs": [p.upper() for p in programs],
        "cabins": cabins,
        "date": date,
        "pax": str(pax),
        "api_key": AWARD_TOOL_API_KEY,
    }
    
    print(f"  [AwardTool] Fetching award flights {origin}->{destination} on {date}...")
    
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(AWARDTOOL_URL, json=payload)
            r.raise_for_status()
            body = r.json()
            data = body.get("data", []) if isinstance(body, dict) else []
            print(f"  [AwardTool] Found {len(data)} award options")
            return data
        except Exception as e:
            print(f"  [!] AwardTool error: {e}")
            return []


def extract_award_flights(award_data: List[Dict], date: str) -> Dict[str, Dict]:
    """
    Extract award flight info from AwardTool response.
    Returns dict keyed by (origin, destination, flight_number) with points info.
    """
    flights_by_key = {}
    
    for item in award_data:
        fare = item.get("fare") or {}
        products = fare.get("products") or []
        points = item.get("award_points")
        surcharge = item.get("surcharge") or 0
        program = (item.get("program_code") or item.get("airline_code") or "").upper()
        cabin = item.get("cabin") or "Economy"
        
        for product in products:
            origin = (product.get("origin") or "").upper()
            destination = (product.get("destination") or "").upper()
            flight_num = _normalize_flightnum(product.get("flight_number"))
            dep_time = product.get("departure_time") or ""
            arr_time = product.get("arrival_time") or ""
            
            if not origin or not destination or not flight_num or points is None:
                continue
            
            key = (origin, destination, flight_num)
            existing = flights_by_key.get(key)
            
            # Keep the cheapest points option
            if existing is None or points < existing.get("points_cost", float("inf")):
                flights_by_key[key] = {
                    "flight_number": flight_num,
                    "origin": origin,
                    "destination": destination,
                    "date": date,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                    "points_cost": int(points),
                    "points_program": program,
                    "surcharge": float(surcharge) if surcharge else 0,
                    "cabin": cabin,
                }
    
    return flights_by_key


# =============================================================================
# COMBINED FLIGHT DATA FETCHER
# =============================================================================

async def get_live_flights(origin: str, destination: str, date: str) -> List[Flight]:
    """
    Fetch live flight data from both SerpAPI (cash) and AwardTool (points).
    Merges the results into a unified Flight list.
    """
    print(f"\n  Fetching live flight data: {origin} -> {destination} on {date}")
    
    # Fetch from both APIs concurrently
    serp_task = asyncio.create_task(asyncio.to_thread(get_google_flights, origin, destination, date))
    award_task = asyncio.create_task(fetch_awardtool_flights(origin, destination, date))
    
    serp_data, award_data = await asyncio.gather(serp_task, award_task)
    
    # Extract and process data
    cash_flights = extract_flights_from_serp(serp_data, date)
    award_flights = extract_award_flights(award_data, date)
    
    # Merge: start with award flights, add cash prices where available
    merged_flights = {}
    
    # First, add all award flights
    for key, award_info in award_flights.items():
        cash_info = cash_flights.get(key, {})
        merged_flights[key] = Flight(
            flight_number=award_info["flight_number"],
            origin=award_info["origin"],
            destination=award_info["destination"],
            date=award_info["date"],
            departure_time=award_info.get("departure_time") or cash_info.get("departure_time", ""),
            arrival_time=award_info.get("arrival_time") or cash_info.get("arrival_time", ""),
            cash_cost=cash_info.get("cash_cost"),
            points_cost=award_info["points_cost"],
            points_program=award_info["points_program"],
            surcharge=award_info["surcharge"],
            cabin=award_info.get("cabin", "Economy"),
        )
    
    # Then add cash-only flights that don't have award availability
    for key, cash_info in cash_flights.items():
        if key not in merged_flights:
            merged_flights[key] = Flight(
                flight_number=cash_info["flight_number"],
                origin=cash_info["origin"],
                destination=cash_info["destination"],
                date=cash_info["date"],
                departure_time=cash_info.get("departure_time", ""),
                arrival_time=cash_info.get("arrival_time", ""),
                cash_cost=cash_info["cash_cost"],
                points_cost=None,
                points_program=None,
                surcharge=0,
                cabin="Economy",
            )
    
    flights = list(merged_flights.values())
    print(f"  Total flights found: {len(flights)} ({len(award_flights)} with awards, {len(cash_flights)} with cash prices)")
    
    return flights


# =============================================================================
# MOCK HOTEL DATA (Hotels API not available - using realistic mock data)
# =============================================================================

def get_mock_hotels(location: str, check_in: str, check_out: str, nights: int) -> List[Hotel]:
    """Get mock hotel data (hotel APIs typically require different integration)."""
    hotels_by_city = {
        "seoul": [
            Hotel("Grand Hyatt Seoul", "Seoul", check_in, check_out, nights, 2700, 20000*nights, "HYATT", 45),
            Hotel("Conrad Seoul", "Seoul", check_in, check_out, nights, 2400, 60000*nights, "HH", 40),
            Hotel("JW Marriott Seoul", "Seoul", check_in, check_out, nights, 2500, 45000*nights, "MAR", 35),
        ],
        "tokyo": [
            Hotel("Park Hyatt Tokyo", "Tokyo", check_in, check_out, nights, 3200, 30000*nights, "HYATT", 50),
            Hotel("Conrad Tokyo", "Tokyo", check_in, check_out, nights, 2800, 80000*nights, "HH", 45),
            Hotel("The Ritz-Carlton Tokyo", "Tokyo", check_in, check_out, nights, 3500, 70000*nights, "MAR", 55),
        ],
        "paris": [
            Hotel("Hilton Paris Opera", "Paris", check_in, check_out, nights, 1200, 80000*nights, "HH", 40),
            Hotel("Paris Marriott Opera", "Paris", check_in, check_out, nights, 1100, 50000*nights, "MAR", 35),
            Hotel("Park Hyatt Paris", "Paris", check_in, check_out, nights, 1800, 30000*nights, "HYATT", 50),
        ],
        "london": [
            Hotel("The Londoner", "London", check_in, check_out, nights, 1500, 70000*nights, "HH", 45),
            Hotel("JW Marriott Grosvenor House", "London", check_in, check_out, nights, 1400, 60000*nights, "MAR", 40),
            Hotel("Andaz London", "London", check_in, check_out, nights, 1300, 25000*nights, "HYATT", 35),
        ],
        "los angeles": [
            Hotel("InterContinental LA", "Los Angeles", check_in, check_out, nights, 750, 40000*nights, "IHG", 25),
            Hotel("Waldorf Astoria Beverly Hills", "Los Angeles", check_in, check_out, nights, 1200, 95000*nights, "HH", 45),
        ],
        "new york": [
            Hotel("Park Hyatt New York", "New York", check_in, check_out, nights, 1800, 30000*nights, "HYATT", 50),
            Hotel("The Ritz-Carlton New York", "New York", check_in, check_out, nights, 2000, 70000*nights, "MAR", 55),
        ],
    }
    
    loc_lower = location.lower()
    for key in hotels_by_city:
        if key in loc_lower or loc_lower in key:
            return hotels_by_city[key]
    
    # Default hotels for any destination
    return [
        Hotel(f"Hilton {location}", location, check_in, check_out, nights, 800, 50000*nights, "HH", 30),
        Hotel(f"Marriott {location}", location, check_in, check_out, nights, 750, 40000*nights, "MAR", 25),
    ]


# =============================================================================
# TRANSFER STRATEGY GENERATOR
# =============================================================================

def find_best_transfer_source(program: str, points_needed: int, available_points: Dict[str, int]):
    """Find the best bank to transfer from."""
    best = None
    for bank, transfers in TRANSFER_GRAPH.items():
        if program not in transfers:
            continue
        balance = available_points.get(bank, 0)
        if balance <= 0:
            continue
        ratio = transfers[program]["ratio"]
        bank_points_needed = int(points_needed / ratio)
        if balance >= bank_points_needed:
            if best is None or ratio > best[2]:
                best = (bank, bank_points_needed, ratio)
    return best


def generate_strategy(flights: List[Flight], hotels: List[Hotel], available_points: Dict[str, int]):
    """Generate transfer strategy."""
    transfers = []
    bookings = []
    remaining = dict(available_points)
    
    # Process flights
    for f in flights:
        if f.points_cost and f.points_program:
            source = find_best_transfer_source(f.points_program, f.points_cost, remaining)
            if source:
                bank, bank_pts, ratio = source
                bank_info = BANK_INFO.get(bank, {})
                prog_info = TRANSFER_GRAPH.get(bank, {}).get(f.points_program, {})
                
                transfers.append(TransferAction(
                    bank=bank,
                    bank_short=bank_info.get("short", bank),
                    program=f.points_program,
                    program_name=prog_info.get("name", f.points_program),
                    points_to_transfer=bank_pts,
                    resulting_points=int(bank_pts * ratio),
                    ratio=ratio,
                    transfer_time=bank_info.get("time", "varies"),
                    for_booking=f"{f.flight_number} {f.origin} -> {f.destination} on {f.date}",
                ))
                
                remaining[bank] = remaining.get(bank, 0) - bank_pts
                
                bookings.append(BookingAction(
                    booking_type="flight",
                    description=f"{f.flight_number} {f.origin} -> {f.destination}",
                    payment_method="points",
                    points_program=f.points_program,
                    points_amount=f.points_cost,
                    surcharge=f.surcharge,
                ))
            elif f.cash_cost:
                bookings.append(BookingAction(
                    booking_type="flight",
                    description=f"{f.flight_number} {f.origin} -> {f.destination}",
                    payment_method="cash",
                    cash_amount=f.cash_cost,
                ))
        elif f.cash_cost:
            bookings.append(BookingAction(
                booking_type="flight",
                description=f"{f.flight_number} {f.origin} -> {f.destination}",
                payment_method="cash",
                cash_amount=f.cash_cost,
            ))
    
    # Process hotels
    for h in hotels:
        source = find_best_transfer_source(h.points_program, h.points_cost, remaining)
        if source:
            bank, bank_pts, ratio = source
            bank_info = BANK_INFO.get(bank, {})
            prog_info = TRANSFER_GRAPH.get(bank, {}).get(h.points_program, {})
            
            transfers.append(TransferAction(
                bank=bank,
                bank_short=bank_info.get("short", bank),
                program=h.points_program,
                program_name=prog_info.get("name", h.points_program),
                points_to_transfer=bank_pts,
                resulting_points=int(bank_pts * ratio),
                ratio=ratio,
                transfer_time=bank_info.get("time", "varies"),
                for_booking=f"{h.name} ({h.nights} nights)",
            ))
            
            remaining[bank] = remaining.get(bank, 0) - bank_pts
            
            bookings.append(BookingAction(
                booking_type="hotel",
                description=f"{h.name} ({h.nights} nights)",
                payment_method="points",
                points_program=h.points_program,
                points_amount=h.points_cost,
                surcharge=h.surcharge,
            ))
        else:
            bookings.append(BookingAction(
                booking_type="hotel",
                description=f"{h.name} ({h.nights} nights)",
                payment_method="cash",
                cash_amount=h.cash_cost,
            ))
    
    # Calculate totals
    total_oop = sum(b.surcharge + b.cash_amount for b in bookings)
    total_cash = sum(f.cash_cost or 0 for f in flights) + sum(h.cash_cost for h in hotels)
    
    return transfers, bookings, {
        "total_oop": total_oop,
        "total_cash": total_cash,
        "savings": total_cash - total_oop,
        "remaining": remaining,
    }


# =============================================================================
# OUTPUT FORMATTING
# =============================================================================

def print_divider(char="=", width=80):
    print(char * width)


def print_header(title):
    print()
    print_divider()
    print(f"  {title}")
    print_divider()


def print_strategy(transfers: List[TransferAction], bookings: List[BookingAction], summary: Dict):
    """Print the strategy in a nice format."""
    
    print_header("POINTS TRANSFER STRATEGY")
    
    print()
    print(f"  TOTAL OUT-OF-POCKET: ${summary['total_oop']:,.2f}")
    print(f"  vs. All Cash:        ${summary['total_cash']:,.2f}")
    print(f"  YOU SAVE:            ${summary['savings']:,.2f}")
    print()
    
    # One-liner transfer instructions
    print_divider("-")
    print("  TRANSFER INSTRUCTIONS (Copy-Paste Ready)")
    print_divider("-")
    print()
    
    for i, t in enumerate(transfers, 1):
        ratio_str = f"1:{int(t.ratio)}" if t.ratio >= 1 else "1:1"
        print(f"  {i}. Transfer {t.points_to_transfer:,} {t.bank_short} points to {t.program_name} to book {t.for_booking}")
    print()
    
    # Detailed transfer steps
    print_divider("-")
    print("  STEP 1: TRANSFER YOUR POINTS")
    print_divider("-")
    print()
    
    for i, t in enumerate(transfers, 1):
        ratio_str = f"1:{int(t.ratio)}" if t.ratio >= 1 else "1:1"
        print(f"  {i}. {BANK_INFO.get(t.bank, {}).get('name', t.bank)} -> {t.program_name}")
        print(f"     Transfer {t.points_to_transfer:,} points ({ratio_str})")
        print(f"     Receive {t.resulting_points:,} {t.program_name} points")
        print(f"     Transfer time: {t.transfer_time}")
        print(f"     For: {t.for_booking}")
        print()
    
    # Booking instructions
    print_divider("-")
    print("  STEP 2: BOOK YOUR TRIP")
    print_divider("-")
    print()
    
    for b in bookings:
        icon = "[FLIGHT]" if b.booking_type == "flight" else "[HOTEL]"
        if b.payment_method == "points":
            prog_name = PROGRAM_INFO.get(b.points_program, {}).get("name", b.points_program)
            url = PROGRAM_INFO.get(b.points_program, {}).get("url", "")
            print(f"  {icon} {b.description}")
            print(f"     Pay: {b.points_amount:,} {prog_name} points + ${b.surcharge:.2f} taxes")
            if url:
                print(f"     Book at: {url}")
        else:
            print(f"  [CASH] {b.description}")
            print(f"     Pay: ${b.cash_amount:,.2f} cash")
        print()
    
    # Remaining points
    print_divider("-")
    print("  REMAINING POINTS")
    print_divider("-")
    print()
    for bank, pts in summary["remaining"].items():
        if pts > 0:
            name = BANK_INFO.get(bank, {}).get("name", bank)
            print(f"  * {name}: {pts:,} points")
    print()
    print_divider()


# =============================================================================
# TEST SCENARIOS
# =============================================================================

async def test_live_trip():
    """Test with live API data for an arbitrary route."""
    
    # Pick a random route and date
    routes = [
        ("JFK", "LHR", "New York to London"),
        ("LAX", "NRT", "Los Angeles to Tokyo"),
        ("SFO", "CDG", "San Francisco to Paris"),
        ("ORD", "FCO", "Chicago to Rome"),
        ("MIA", "MAD", "Miami to Madrid"),
    ]
    
    origin, destination, route_name = random.choice(routes)
    outbound_date = get_random_future_date(30, 60)
    
    # Calculate return date (7 days later)
    outbound_dt = datetime.strptime(outbound_date, "%Y-%m-%d")
    return_date = (outbound_dt + timedelta(days=7)).strftime("%Y-%m-%d")
    nights = 6
    
    print_header(f"TEST: {route_name} (LIVE DATA)")
    print(f"  Route: {origin} -> {destination} -> {origin}")
    print(f"  Dates: {outbound_date} to {return_date}")
    print(f"  Hotel: {nights} nights")
    
    available_points = {
        "chase": 150000,
        "amex": 200000,
        "bilt": 75000,
    }
    
    print()
    print("  Your Points:")
    for bank, pts in available_points.items():
        print(f"    - {BANK_INFO.get(bank, {}).get('name', bank)}: {pts:,}")
    
    # Fetch LIVE flight data
    outbound_flights = await get_live_flights(origin, destination, outbound_date)
    return_flights = await get_live_flights(destination, origin, return_date)
    
    # Get hotels (mock for now)
    destination_city = {
        "LHR": "London", "NRT": "Tokyo", "CDG": "Paris", 
        "FCO": "Rome", "MAD": "Madrid"
    }.get(destination, destination)
    hotels = get_mock_hotels(destination_city, outbound_date, return_date, nights)
    
    # Show available options
    print()
    print("  OUTBOUND FLIGHT OPTIONS:")
    award_outbound = [f for f in outbound_flights if f.points_cost][:5]
    if award_outbound:
        for f in award_outbound:
            cash_str = f"${f.cash_cost:,.0f}" if f.cash_cost else "N/A"
            print(f"    {f.flight_number} ({f.departure_time}): {f.points_cost:,} {f.points_program} + ${f.surcharge:.0f} (cash: {cash_str})")
    else:
        print("    No award flights found - showing cash options:")
        for f in outbound_flights[:5]:
            if f.cash_cost:
                print(f"    {f.flight_number} ({f.departure_time}): ${f.cash_cost:,.0f}")
    
    print()
    print("  RETURN FLIGHT OPTIONS:")
    award_return = [f for f in return_flights if f.points_cost][:5]
    if award_return:
        for f in award_return:
            cash_str = f"${f.cash_cost:,.0f}" if f.cash_cost else "N/A"
            print(f"    {f.flight_number} ({f.departure_time}): {f.points_cost:,} {f.points_program} + ${f.surcharge:.0f} (cash: {cash_str})")
    else:
        print("    No award flights found - showing cash options:")
        for f in return_flights[:5]:
            if f.cash_cost:
                print(f"    {f.flight_number} ({f.departure_time}): ${f.cash_cost:,.0f}")
    
    print()
    print("  HOTEL OPTIONS:")
    for h in hotels[:3]:
        print(f"    {h.name}: {h.points_cost:,} {h.points_program} + ${h.surcharge:.0f} (cash: ${h.cash_cost:,.0f})")
    
    # Select best options
    # Prefer award flights, fall back to cheapest cash
    if award_outbound:
        best_outbound = min(award_outbound, key=lambda x: x.points_cost)
    elif outbound_flights:
        best_outbound = min([f for f in outbound_flights if f.cash_cost], key=lambda x: x.cash_cost, default=None)
    else:
        best_outbound = None
    
    if award_return:
        best_return = min(award_return, key=lambda x: x.points_cost)
    elif return_flights:
        best_return = min([f for f in return_flights if f.cash_cost], key=lambda x: x.cash_cost, default=None)
    else:
        best_return = None
    
    best_hotel = min(hotels, key=lambda x: x.points_cost) if hotels else None
    
    if not best_outbound or not best_return:
        print()
        print("  [!] Could not find flights for this route/date. Try running again.")
        return
    
    print()
    print("  SELECTED OPTIONS:")
    if best_outbound.points_cost:
        print(f"    Outbound: {best_outbound.flight_number} ({best_outbound.points_cost:,} {best_outbound.points_program})")
    else:
        print(f"    Outbound: {best_outbound.flight_number} (${best_outbound.cash_cost:,.0f} cash)")
    
    if best_return.points_cost:
        print(f"    Return:   {best_return.flight_number} ({best_return.points_cost:,} {best_return.points_program})")
    else:
        print(f"    Return:   {best_return.flight_number} (${best_return.cash_cost:,.0f} cash)")
    
    if best_hotel:
        print(f"    Hotel:    {best_hotel.name} ({best_hotel.points_cost:,} {best_hotel.points_program})")
    
    # Generate strategy
    selected_flights = [best_outbound, best_return]
    selected_hotels = [best_hotel] if best_hotel else []
    
    transfers, bookings, summary = generate_strategy(
        selected_flights,
        selected_hotels,
        available_points
    )
    
    print_strategy(transfers, bookings, summary)


async def test_specific_route(origin: str, destination: str, date: str = None):
    """Test a specific route with live data."""
    
    if date is None:
        date = get_random_future_date(30, 60)
    
    return_dt = datetime.strptime(date, "%Y-%m-%d") + timedelta(days=5)
    return_date = return_dt.strftime("%Y-%m-%d")
    nights = 4
    
    print_header(f"TEST: {origin} -> {destination} (LIVE DATA)")
    print(f"  Route: {origin} -> {destination} -> {origin}")
    print(f"  Dates: {date} to {return_date}")
    
    available_points = {
        "chase": 200000,
        "amex": 150000,
    }
    
    print()
    print("  Your Points:")
    for bank, pts in available_points.items():
        print(f"    - {BANK_INFO.get(bank, {}).get('name', bank)}: {pts:,}")
    
    # Fetch live data
    outbound = await get_live_flights(origin, destination, date)
    returns = await get_live_flights(destination, origin, return_date)
    
    if not outbound and not returns:
        print()
        print("  [!] No flight data available. Check API keys and route validity.")
        return
    
    # Show and select best options
    award_out = [f for f in outbound if f.points_cost]
    award_ret = [f for f in returns if f.points_cost]
    
    print()
    print(f"  Found: {len(outbound)} outbound options ({len(award_out)} with awards)")
    print(f"  Found: {len(returns)} return options ({len(award_ret)} with awards)")
    
    # Select best
    if award_out:
        best_out = min(award_out, key=lambda x: x.points_cost)
    elif outbound:
        best_out = min([f for f in outbound if f.cash_cost], key=lambda x: x.cash_cost, default=None)
    else:
        best_out = None
    
    if award_ret:
        best_ret = min(award_ret, key=lambda x: x.points_cost)
    elif returns:
        best_ret = min([f for f in returns if f.cash_cost], key=lambda x: x.cash_cost, default=None)
    else:
        best_ret = None
    
    if not best_out or not best_ret:
        print("  [!] Insufficient flight data for strategy generation.")
        return
    
    print()
    print("  BEST OPTIONS:")
    print(f"    Out: {best_out.flight_number} - {best_out.points_cost:,} {best_out.points_program} + ${best_out.surcharge:.0f}" if best_out.points_cost else f"    Out: {best_out.flight_number} - ${best_out.cash_cost:,.0f}")
    print(f"    Ret: {best_ret.flight_number} - {best_ret.points_cost:,} {best_ret.points_program} + ${best_ret.surcharge:.0f}" if best_ret.points_cost else f"    Ret: {best_ret.flight_number} - ${best_ret.cash_cost:,.0f}")
    
    transfers, bookings, summary = generate_strategy(
        [best_out, best_ret],
        [],
        available_points
    )
    
    print_strategy(transfers, bookings, summary)


# =============================================================================
# MAIN
# =============================================================================

async def main():
    print()
    print_divider("=")
    print("  TRIPY POINTS TRANSFER STRATEGY TEST - LIVE API")
    print("  Using SerpAPI (Google Flights) and AwardTool for live data")
    print_divider("=")
    
    api_status = []
    if SERPAPI_KEY:
        api_status.append("SerpAPI: OK")
    else:
        api_status.append("SerpAPI: MISSING")
    if AWARD_TOOL_API_KEY:
        api_status.append("AwardTool: OK")
    else:
        api_status.append("AwardTool: MISSING")
    
    print()
    print(f"  API Status: {' | '.join(api_status)}")
    
    # Run live tests
    await test_live_trip()
    
    # Test a specific popular route
    await test_specific_route("JFK", "LHR")
    
    print()
    print_divider("=")
    print("  ALL TESTS COMPLETE")
    print_divider("=")
    print()


if __name__ == "__main__":
    asyncio.run(main())
