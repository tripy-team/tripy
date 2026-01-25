#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Points Transfer Strategy Test Script - LIVE API VERSION

This script uses the actual AwardTool and SerpAPI to fetch real flight and hotel
data, then generates specific transfer instructions.

Usage:
    python test_transfer_strategy_live.py

Requirements:
    pip install pulp httpx python-dotenv

Environment Variables:
    AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY - AwardTool API key
    SERPAPI_KEY or SERP_API_KEY - SerpAPI key (optional, for cash prices)

Example Output:
    Transfer 50,000 Amex points to Delta to book DL158 JFK->ICN on Mar 15
    Transfer 40,000 Chase points to Hyatt to book Grand Hyatt Seoul (5 nights)
"""

import asyncio
import json
import os
import re
import sys
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

# Add parent directory to path for imports
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import pulp as pl
except ImportError:
    print("Error: pulp package required. Install with: pip install pulp")
    sys.exit(1)

try:
    import httpx
except ImportError:
    print("Error: httpx package required. Install with: pip install httpx")
    sys.exit(1)

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    print("Warning: python-dotenv not installed. Using environment variables directly.")

# API Keys
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
SERPAPI_KEY = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")

if not AWARD_TOOL_API_KEY:
    print("WARNING: AWARD_TOOL_API_KEY not set. API calls may fail.")
    print("Set it with: export AWARD_TOOL_API_KEY=your_key_here")

TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=20)


# =============================================================================
# TRANSFER GRAPH
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
        "HH": {"ratio": 2.0, "type": "hotel", "name": "Hilton Honors"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
    "chase": {
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France Flying Blue"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
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
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
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
    "HH": {"name": "Hilton Honors", "booking_url": "hilton.com"},
    "MAR": {"name": "Marriott Bonvoy", "booking_url": "marriott.com"},
    "HYATT": {"name": "World of Hyatt", "booking_url": "hyatt.com"},
    "IHG": {"name": "IHG One Rewards", "booking_url": "ihg.com"},
}

# Default award programs for AwardTool
AIRLINE_PROGRAMS = ["UA", "AA", "DL", "AS", "B6", "AF", "BA", "SQ", "NH", "EK", "VS", "AV"]
HOTEL_PROGRAMS = ["HH", "IHG", "MAR", "HYATT"]


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
class HotelOption:
    """A hotel option from the API."""
    hotel_id: str
    name: str
    brand: str
    program_code: str
    cash_cost: Optional[float] = None
    points_cost: Optional[int] = None
    surcharge: Optional[float] = None
    nights: int = 1


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
    booking_type: str  # "flight" or "hotel"
    description: str  # e.g., "DL158 JFK->ICN"
    payment_method: str  # "points" or "cash"
    points_program: Optional[str] = None
    points_amount: Optional[int] = None
    cash_amount: float = 0.0
    surcharge: float = 0.0
    booking_url: str = ""


# =============================================================================
# API FUNCTIONS
# =============================================================================

async def fetch_flights_awardtool(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str] = None,
    programs: List[str] = None,
    pax: int = 1,
) -> List[FlightOption]:
    """Fetch flight options from AwardTool API."""
    
    if not AWARD_TOOL_API_KEY:
        print(f"  [!] No API key - using mock data for {origin}->{destination}")
        return _mock_flights(origin, destination, date)
    
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
    
    print(f"  [API] Fetching flights {origin}->{destination} on {date}...")
    
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(
                "https://www.awardtool-api.com/search_real_time",
                json=payload
            )
            r.raise_for_status()
            body = r.json()
        except Exception as e:
            print(f"  [!] API error: {e}")
            return _mock_flights(origin, destination, date)
    
    flights = []
    data = body.get("data", []) if isinstance(body, dict) else []
    
    for item in data:
        fare = item.get("fare") or {}
        products = fare.get("products") or []
        pts = item.get("award_points")
        sur = item.get("surcharge") or 0
        prog = (item.get("program_code") or item.get("airline_code") or "").upper()
        xfer = item.get("transfer_options") or []
        cabin = item.get("cabin") or "Economy"
        
        for p in products:
            fn = (p.get("flight_number") or "").strip().upper().replace(" ", "")
            dep = (p.get("origin") or "").upper()
            arr = (p.get("destination") or "").upper()
            dep_time = p.get("departure_time") or ""
            arr_time = p.get("arrival_time") or ""
            
            if fn and pts:
                flights.append(FlightOption(
                    flight_number=fn,
                    origin=dep,
                    destination=arr,
                    departure_time=dep_time,
                    arrival_time=arr_time,
                    airline_code=fn[:2] if len(fn) >= 2 else prog,
                    points_cost=int(pts),
                    points_program=prog,
                    surcharge=float(sur) if sur else 0,
                    transfer_partners=xfer,
                    cabin=cabin,
                ))
    
    print(f"  [API] Found {len(flights)} award flights")
    return flights


async def fetch_hotels_awardtool(
    destination: str,
    check_in: str,
    check_out: str,
    programs: List[str] = None,
    guests: int = 1,
) -> List[HotelOption]:
    """Fetch hotel options from AwardTool API."""
    
    if not AWARD_TOOL_API_KEY:
        print(f"  [!] No API key - using mock data for hotels in {destination}")
        return _mock_hotels(destination, check_in, check_out)
    
    programs = programs or HOTEL_PROGRAMS
    
    # Calculate nights
    try:
        d1 = datetime.strptime(check_in, "%Y-%m-%d")
        d2 = datetime.strptime(check_out, "%Y-%m-%d")
        nights = (d2 - d1).days
    except:
        nights = 1
    
    payload = {
        "destination": destination.strip(),
        "check_in": check_in,
        "check_out": check_out,
        "programs": [p.upper() for p in programs],
        "guests": guests,
        "api_key": AWARD_TOOL_API_KEY,
    }
    
    print(f"  [API] Fetching hotels in {destination} ({check_in} to {check_out})...")
    
    async with httpx.AsyncClient(timeout=TIMEOUT) as client:
        try:
            r = await client.post(
                "https://www.awardtool-api.com/search_hotel",
                json=payload
            )
            r.raise_for_status()
            body = r.json()
        except Exception as e:
            print(f"  [!] API error: {e}")
            return _mock_hotels(destination, check_in, check_out)
    
    hotels = []
    data = body.get("data", body.get("hotels", []))
    
    for i, item in enumerate(data if isinstance(data, list) else []):
        if not isinstance(item, dict):
            continue
        
        hid = item.get("hotel_id") or item.get("id") or f"h{i}"
        name = item.get("name") or item.get("hotel_name") or f"Hotel {hid}"
        brand = (item.get("brand") or item.get("program_code") or "").strip()
        prog = (item.get("program_code") or brand or "").strip().upper()
        cash = _to_number(item.get("cash_rate") or item.get("cash_cost"))
        pts = _to_number(item.get("points") or item.get("award_points"))
        sur = _to_number(item.get("surcharge")) or 0
        
        if pts:
            hotels.append(HotelOption(
                hotel_id=str(hid),
                name=name,
                brand=brand or prog,
                program_code=prog,
                cash_cost=cash,
                points_cost=int(pts) if pts else None,
                surcharge=float(sur),
                nights=nights,
            ))
    
    print(f"  [API] Found {len(hotels)} hotel options")
    return hotels


def _to_number(v) -> Optional[float]:
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


def _mock_flights(origin: str, destination: str, date: str) -> List[FlightOption]:
    """Generate mock flight data when API is not available."""
    # Parse date for display
    try:
        dt = datetime.strptime(date, "%Y-%m-%d")
        date_display = dt.strftime("%b %d")
    except:
        date_display = date
    
    mocks = {
        ("JFK", "ICN"): [
            FlightOption("KE82", "JFK", "ICN", "10:30", "14:20+1", "KE", 4500, 80000, "DL", 85, [], "Economy"),
            FlightOption("DL159", "JFK", "ICN", "11:45", "16:00+1", "DL", 4200, 95000, "DL", 75, [], "Business"),
            FlightOption("OZ223", "JFK", "ICN", "00:40", "05:10+1", "OZ", 3800, 70000, "UA", 120, [], "Economy"),
        ],
        ("ICN", "JFK"): [
            FlightOption("KE81", "ICN", "JFK", "09:00", "09:30", "KE", 4300, 80000, "DL", 85, [], "Economy"),
            FlightOption("DL158", "ICN", "JFK", "17:30", "17:45", "DL", 4100, 90000, "DL", 70, [], "Business"),
        ],
        ("JFK", "CDG"): [
            FlightOption("AF007", "JFK", "CDG", "19:00", "08:30+1", "AF", 850, 55000, "AF", 120, [], "Economy"),
            FlightOption("DL264", "JFK", "CDG", "22:00", "11:45+1", "DL", 920, 80000, "DL", 45, [], "Economy"),
        ],
        ("CDG", "FCO"): [
            FlightOption("AF1404", "CDG", "FCO", "07:15", "09:15", "AF", 180, 12000, "AF", 30, [], "Economy"),
            FlightOption("AZ319", "CDG", "FCO", "10:30", "12:35", "AZ", 165, None, None, 0, [], "Economy"),
        ],
        ("BCN", "JFK"): [
            FlightOption("UA63", "BCN", "JFK", "11:30", "14:15", "UA", 780, 60000, "UA", 45, [], "Economy"),
            FlightOption("IB6251", "BCN", "JFK", "12:45", "15:20", "IB", 720, 34000, "IB", 85, [], "Economy"),
        ],
        ("SFO", "LAX"): [
            FlightOption("UA234", "SFO", "LAX", "08:00", "09:30", "UA", 180, 12500, "UA", 5.60, [], "Economy"),
            FlightOption("DL1234", "SFO", "LAX", "09:15", "10:45", "DL", 165, 10000, "DL", 5.60, [], "Economy"),
        ],
        ("LAX", "SFO"): [
            FlightOption("UA567", "LAX", "SFO", "18:00", "19:30", "UA", 175, 12500, "UA", 5.60, [], "Economy"),
            FlightOption("B61234", "LAX", "SFO", "17:30", "19:00", "B6", 155, 8500, "B6", 5.60, [], "Economy"),
        ],
    }
    
    key = (origin.upper(), destination.upper())
    return mocks.get(key, [])


def _mock_hotels(destination: str, check_in: str, check_out: str) -> List[HotelOption]:
    """Generate mock hotel data when API is not available."""
    try:
        d1 = datetime.strptime(check_in, "%Y-%m-%d")
        d2 = datetime.strptime(check_out, "%Y-%m-%d")
        nights = (d2 - d1).days
    except:
        nights = 3
    
    mocks = {
        "seoul": [
            HotelOption("h1", "Grand Hyatt Seoul", "Hyatt", "HYATT", 2700, 20000 * nights, 45, nights),
            HotelOption("h2", "Conrad Seoul", "Hilton", "HH", 2400, 60000 * nights, 40, nights),
            HotelOption("h3", "JW Marriott Seoul", "Marriott", "MAR", 2500, 45000 * nights, 35, nights),
        ],
        "paris": [
            HotelOption("h4", "Hilton Paris Opera", "Hilton", "HH", 1200, 80000 * nights, 40, nights),
            HotelOption("h5", "Paris Marriott Opera", "Marriott", "MAR", 1100, 50000 * nights, 35, nights),
            HotelOption("h6", "Park Hyatt Paris", "Hyatt", "HYATT", 1800, 30000 * nights, 50, nights),
        ],
        "rome": [
            HotelOption("h7", "Rome Cavalieri Waldorf", "Hilton", "HH", 1400, 95000 * nights, 45, nights),
            HotelOption("h8", "The Westin Excelsior Rome", "Marriott", "MAR", 1500, 60000 * nights, 40, nights),
        ],
        "barcelona": [
            HotelOption("h9", "Hyatt Regency Barcelona", "Hyatt", "HYATT", 900, 20000 * nights, 30, nights),
            HotelOption("h10", "W Barcelona", "Marriott", "MAR", 1100, 45000 * nights, 35, nights),
        ],
        "los angeles": [
            HotelOption("h11", "InterContinental LA Downtown", "IHG", "IHG", 750, 40000 * nights, 25, nights),
            HotelOption("h12", "Waldorf Astoria Beverly Hills", "Hilton", "HH", 1200, 95000 * nights, 45, nights),
        ],
    }
    
    dest_lower = destination.lower()
    for key in mocks:
        if key in dest_lower or dest_lower in key:
            return mocks[key]
    
    return []


# =============================================================================
# TRANSFER STRATEGY GENERATOR
# =============================================================================

def find_best_transfer_source(
    program: str,
    points_needed: int,
    available_points: Dict[str, int],
) -> Optional[Tuple[str, int, float]]:
    """
    Find the best bank to transfer from for a given program.
    Returns (bank, points_to_transfer, ratio) or None.
    """
    best = None
    
    for bank, transfers in EXTENDED_TRANSFER_GRAPH.items():
        if program not in transfers:
            continue
        
        balance = available_points.get(bank, 0)
        if balance <= 0:
            continue
        
        ratio = transfers[program]["ratio"]
        # Calculate how many bank points needed
        bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
        
        if balance >= bank_points_needed:
            # Prefer higher ratio (better value)
            if best is None or ratio > best[2]:
                best = (bank, bank_points_needed, ratio)
    
    return best


def generate_transfer_strategy(
    flights: List[FlightOption],
    hotels: List[HotelOption],
    available_points: Dict[str, int],
    selected_flights: List[str] = None,  # Flight numbers to book
    selected_hotels: List[str] = None,   # Hotel IDs to book
) -> Tuple[List[TransferAction], List[BookingAction], Dict]:
    """
    Generate a complete transfer strategy for the selected bookings.
    
    Returns:
        - List of transfer actions
        - List of booking actions  
        - Summary dict
    """
    transfers = []
    bookings = []
    points_used = {}
    
    # Track remaining points
    remaining_points = dict(available_points)
    
    # Process flights
    flight_map = {f.flight_number: f for f in flights}
    selected_flights = selected_flights or [f.flight_number for f in flights if f.points_cost]
    
    for fn in selected_flights:
        flight = flight_map.get(fn)
        if not flight:
            continue
        
        if flight.points_cost and flight.points_program:
            program = flight.points_program
            points_needed = flight.points_cost
            
            # Find transfer source
            source = find_best_transfer_source(program, points_needed, remaining_points)
            
            if source:
                bank, bank_pts, ratio = source
                resulting_pts = int(bank_pts * ratio)
                
                bank_info = BANK_METADATA.get(bank, {})
                prog_info = EXTENDED_TRANSFER_GRAPH.get(bank, {}).get(program, {})
                
                # Format booking description
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
                
                # Update remaining points
                remaining_points[bank] = remaining_points.get(bank, 0) - bank_pts
                points_used[program] = points_used.get(program, 0) + points_needed
                
                # Add booking action
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
                # Pay cash
                bookings.append(BookingAction(
                    booking_type="flight",
                    description=f"{flight.flight_number} {flight.origin} -> {flight.destination}",
                    payment_method="cash",
                    cash_amount=flight.cash_cost or 0,
                ))
    
    # Process hotels
    hotel_map = {h.hotel_id: h for h in hotels}
    selected_hotels = selected_hotels or [h.hotel_id for h in hotels if h.points_cost]
    
    for hid in selected_hotels:
        hotel = hotel_map.get(hid)
        if not hotel:
            continue
        
        if hotel.points_cost and hotel.program_code:
            program = hotel.program_code
            points_needed = hotel.points_cost
            
            source = find_best_transfer_source(program, points_needed, remaining_points)
            
            if source:
                bank, bank_pts, ratio = source
                resulting_pts = int(bank_pts * ratio)
                
                bank_info = BANK_METADATA.get(bank, {})
                prog_info = EXTENDED_TRANSFER_GRAPH.get(bank, {}).get(program, {})
                
                booking_desc = f"{hotel.name} ({hotel.nights} nights)"
                
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
                    booking_type="hotel",
                    description=f"{hotel.name} ({hotel.nights} nights)",
                    payment_method="points",
                    points_program=program,
                    points_amount=points_needed,
                    surcharge=hotel.surcharge or 0,
                    booking_url=prog_meta.get("booking_url", ""),
                ))
            else:
                bookings.append(BookingAction(
                    booking_type="hotel",
                    description=f"{hotel.name} ({hotel.nights} nights)",
                    payment_method="cash",
                    cash_amount=hotel.cash_cost or 0,
                ))
    
    # Calculate summary
    total_oop = sum(b.surcharge + b.cash_amount for b in bookings)
    total_cash_alternative = sum(
        (flight_map.get(fn).cash_cost or 0) for fn in selected_flights if fn in flight_map
    ) + sum(
        (hotel_map.get(hid).cash_cost or 0) for hid in selected_hotels if hid in hotel_map
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
    """Print the transfer strategy in a beautiful, actionable format."""
    
    print_header("POINTS TRANSFER STRATEGY")
    
    # Summary
    print()
    print(f"  TOTAL OUT-OF-POCKET: ${summary['total_out_of_pocket']:,.2f}")
    print(f"  vs. All Cash:        ${summary['total_cash_alternative']:,.2f}")
    print(f"  YOU SAVE:            ${summary['savings']:,.2f}")
    print()
    
    # Transfer Actions
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
    
    # Booking Actions
    print_divider("-")
    print("  STEP 2: BOOK YOUR TRIP")
    print_divider("-")
    print()
    
    for b in bookings:
        icon = "[FLIGHT]" if b.booking_type == "flight" else "[HOTEL]"
        
        if b.payment_method == "points":
            prog_name = PROGRAM_METADATA.get(b.points_program, {}).get("name", b.points_program)
            print(f"  {icon} {b.description}")
            print(f"     Pay: {b.points_amount:,} {prog_name} points + ${b.surcharge:.2f} taxes")
            if b.booking_url:
                print(f"     Book at: {b.booking_url}")
        else:
            print(f"  [CASH] {b.description}")
            print(f"     Pay: ${b.cash_amount:,.2f} cash")
        print()
    
    # Remaining Points
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


def print_one_liner_strategy(transfers: List[TransferAction]):
    """Print one-liner transfer instructions."""
    
    print()
    print_header("ONE-LINER TRANSFER INSTRUCTIONS")
    print()
    
    for t in transfers:
        print(f"  >> Transfer {t.points_amount:,} {t.bank_name} points to {t.program_name} to book {t.for_booking}")
    
    print()


# =============================================================================
# TEST SCENARIOS
# =============================================================================

async def test_seoul_trip():
    """Test: NYC -> Seoul round trip with hotel."""
    
    print_header("TEST: NYC -> Seoul Round Trip (Business Class)")
    print("  Route: JFK -> ICN -> JFK")
    print("  Dates: 2026-03-15 to 2026-03-25")
    print("  Hotel: Seoul (9 nights)")
    print()
    
    # User's points
    available_points = {
        "chase": 150000,
        "amex": 200000,
    }
    
    print("  Your Points:")
    for bank, pts in available_points.items():
        name = BANK_METADATA.get(bank, {}).get("name", bank)
        print(f"    - {name}: {pts:,}")
    print()
    
    # Fetch flights
    outbound = await fetch_flights_awardtool("JFK", "ICN", "2026-03-15", ["Business"])
    return_fl = await fetch_flights_awardtool("ICN", "JFK", "2026-03-25", ["Business"])
    hotels = await fetch_hotels_awardtool("Seoul", "2026-03-15", "2026-03-24")
    
    # Show options
    print()
    print("  OUTBOUND FLIGHT OPTIONS (JFK -> ICN):")
    for f in outbound[:5]:
        if f.points_cost:
            print(f"    {f.flight_number}: {f.points_cost:,} {f.points_program} + ${f.surcharge:.0f} (cash: ${f.cash_cost or 0:,.0f})")
    
    print()
    print("  RETURN FLIGHT OPTIONS (ICN -> JFK):")
    for f in return_fl[:5]:
        if f.points_cost:
            print(f"    {f.flight_number}: {f.points_cost:,} {f.points_program} + ${f.surcharge:.0f} (cash: ${f.cash_cost or 0:,.0f})")
    
    print()
    print("  HOTEL OPTIONS (Seoul):")
    for h in hotels[:5]:
        if h.points_cost:
            print(f"    {h.name}: {h.points_cost:,} {h.program_code} + ${h.surcharge:.0f} (cash: ${h.cash_cost or 0:,.0f})")
    
    # Select best options
    best_outbound = min([f for f in outbound if f.points_cost], key=lambda x: x.points_cost, default=None)
    best_return = min([f for f in return_fl if f.points_cost], key=lambda x: x.points_cost, default=None)
    best_hotel = min([h for h in hotels if h.points_cost], key=lambda x: x.points_cost, default=None)
    
    if best_outbound and best_return and best_hotel:
        print()
        print("  SELECTED OPTIONS:")
        print(f"    Outbound: {best_outbound.flight_number} ({best_outbound.points_cost:,} {best_outbound.points_program})")
        print(f"    Return:   {best_return.flight_number} ({best_return.points_cost:,} {best_return.points_program})")
        print(f"    Hotel:    {best_hotel.name} ({best_hotel.points_cost:,} {best_hotel.program_code})")
        
        # Generate strategy
        all_flights = outbound + return_fl
        selected_flights = [best_outbound.flight_number, best_return.flight_number]
        selected_hotels = [best_hotel.hotel_id]
        
        transfers, bookings, summary = generate_transfer_strategy(
            all_flights, hotels, available_points,
            selected_flights, selected_hotels
        )
        
        print_strategy(transfers, bookings, summary)
        print_one_liner_strategy(transfers)


async def test_europe_trip():
    """Test: Multi-city Europe trip."""
    
    print_header("TEST: European Adventure")
    print("  Route: JFK -> CDG -> FCO -> BCN -> JFK")
    print("  Dates: 2026-06-01 to 2026-06-15")
    print()
    
    available_points = {
        "chase": 200000,
        "amex": 180000,
        "bilt": 50000,
    }
    
    print("  Your Points:")
    for bank, pts in available_points.items():
        name = BANK_METADATA.get(bank, {}).get("name", bank)
        print(f"    - {name}: {pts:,}")
    print()
    
    # Fetch flights
    leg1 = await fetch_flights_awardtool("JFK", "CDG", "2026-06-01")
    leg2 = await fetch_flights_awardtool("CDG", "FCO", "2026-06-05")
    leg3 = await fetch_flights_awardtool("BCN", "JFK", "2026-06-14")
    
    # Fetch hotels
    paris_hotels = await fetch_hotels_awardtool("Paris", "2026-06-01", "2026-06-05")
    rome_hotels = await fetch_hotels_awardtool("Rome", "2026-06-05", "2026-06-09")
    barcelona_hotels = await fetch_hotels_awardtool("Barcelona", "2026-06-09", "2026-06-14")
    
    all_flights = leg1 + leg2 + leg3
    all_hotels = paris_hotels + rome_hotels + barcelona_hotels
    
    # Select best options
    selected_flights = []
    for flights in [leg1, leg2, leg3]:
        best = min([f for f in flights if f.points_cost], key=lambda x: x.points_cost, default=None)
        if best:
            selected_flights.append(best.flight_number)
    
    selected_hotels = []
    for hotels in [paris_hotels, rome_hotels, barcelona_hotels]:
        best = min([h for h in hotels if h.points_cost], key=lambda x: x.points_cost, default=None)
        if best:
            selected_hotels.append(best.hotel_id)
    
    print("  SELECTED FLIGHTS:")
    for fn in selected_flights:
        f = next((x for x in all_flights if x.flight_number == fn), None)
        if f:
            print(f"    {f.flight_number} {f.origin}->{f.destination}: {f.points_cost:,} {f.points_program}")
    
    print()
    print("  SELECTED HOTELS:")
    for hid in selected_hotels:
        h = next((x for x in all_hotels if x.hotel_id == hid), None)
        if h:
            print(f"    {h.name}: {h.points_cost:,} {h.program_code}")
    
    # Generate strategy
    transfers, bookings, summary = generate_transfer_strategy(
        all_flights, all_hotels, available_points,
        selected_flights, selected_hotels
    )
    
    print_strategy(transfers, bookings, summary)
    print_one_liner_strategy(transfers)


async def test_simple_domestic():
    """Test: Simple domestic trip."""
    
    print_header("TEST: Quick LA Getaway")
    print("  Route: SFO -> LAX -> SFO")
    print("  Dates: 2026-02-14 to 2026-02-17")
    print()
    
    available_points = {
        "chase": 50000,
        "amex": 30000,
    }
    
    print("  Your Points:")
    for bank, pts in available_points.items():
        name = BANK_METADATA.get(bank, {}).get("name", bank)
        print(f"    - {name}: {pts:,}")
    print()
    
    # Fetch data
    outbound = await fetch_flights_awardtool("SFO", "LAX", "2026-02-14")
    return_fl = await fetch_flights_awardtool("LAX", "SFO", "2026-02-17")
    hotels = await fetch_hotels_awardtool("Los Angeles", "2026-02-14", "2026-02-17")
    
    all_flights = outbound + return_fl
    
    # Select best
    best_out = min([f for f in outbound if f.points_cost], key=lambda x: x.points_cost, default=None)
    best_ret = min([f for f in return_fl if f.points_cost], key=lambda x: x.points_cost, default=None)
    best_hotel = min([h for h in hotels if h.points_cost], key=lambda x: x.points_cost, default=None)
    
    selected_flights = [f.flight_number for f in [best_out, best_ret] if f]
    selected_hotels = [best_hotel.hotel_id] if best_hotel else []
    
    transfers, bookings, summary = generate_transfer_strategy(
        all_flights, hotels, available_points,
        selected_flights, selected_hotels
    )
    
    print_strategy(transfers, bookings, summary)
    print_one_liner_strategy(transfers)


# =============================================================================
# MAIN
# =============================================================================

async def main():
    print()
    print_divider("=")
    print("  TRIPY POINTS TRANSFER STRATEGY - LIVE API TEST")
    print("  Fetches real flight/hotel data and generates specific transfer instructions")
    print_divider("=")
    
    if not AWARD_TOOL_API_KEY:
        print()
        print("  NOTE: Running with MOCK DATA (no API key found)")
        print("  Set AWARD_TOOL_API_KEY environment variable for live data")
    
    # Run tests
    await test_seoul_trip()
    await test_europe_trip()
    await test_simple_domestic()
    
    print()
    print_divider("=")
    print("  ALL TESTS COMPLETE")
    print_divider("=")
    print()


if __name__ == "__main__":
    asyncio.run(main())
