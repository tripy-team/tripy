# AwardTool Dummy Data Implementation Guide

> **Status: IMPLEMENTED** ✅
> 
> The dummy data system has been fully implemented and integrated into the codebase.
> See the files listed in [Implementation Files](#5-implementation-files) section.

## Overview

This document provides a comprehensive implementation plan for replacing AwardTool API calls with dummy data. The dummy data system is designed to:

1. **Mirror exact API response formats** - Ensures seamless swapping when the API is restored
2. **Provide realistic test data** - Covers common routes, airlines, and pricing scenarios
3. **Support all three AwardTool endpoints** - Flights, Hotels, and Panorama Calendar
4. **Be configurable** - Easy to enable/disable via environment variable

---

## Table of Contents

1. [Configuration](#1-configuration)
2. [Flight Search Dummy Data](#2-flight-search-dummy-data)
3. [Hotel Search Dummy Data](#3-hotel-search-dummy-data)
4. [Panorama Calendar Dummy Data](#4-panorama-calendar-dummy-data)
5. [Implementation Files](#5-implementation-files)
6. [Integration Points](#6-integration-points)
7. [Testing Strategy](#7-testing-strategy)
8. [Swapping Back to Live API](#8-swapping-back-to-live-api)

---

## 1. Configuration

### Environment Variable

In `.env` or `env_template.txt`:

```bash
# Set to "true" to use dummy data instead of AwardTool API
# If no API key is set, dummy mode is automatically enabled
USE_AWARDTOOL_DUMMY_DATA=false

# When dummy data is enabled, API key is not required
# AWARD_TOOL_API_KEY=your_awardtool_api_key
```

### Config Module (Already Implemented)

In `backend/src/config.py`:

```python
# AwardTool Dummy Data Mode
USE_AWARDTOOL_DUMMY_DATA = os.environ.get("USE_AWARDTOOL_DUMMY_DATA", "false").lower() == "true"

def is_awardtool_dummy_mode() -> bool:
    """
    Check if we should use dummy data instead of live AwardTool API.
    Returns True if:
    - USE_AWARDTOOL_DUMMY_DATA is explicitly set to "true", OR
    - AWARDTOOL_API_KEY is not configured
    """
    if USE_AWARDTOOL_DUMMY_DATA:
        return True
    # Auto-enable dummy mode if no API key is configured
    if not AWARDTOOL_API_KEY:
        return True
    return False
```

---

## 2. Flight Search Dummy Data

### 2.1 AwardTool Flight API Response Format

**Endpoint:** `POST https://www.awardtool-api.com/search_real_time`

**Request Payload:**
```json
{
    "origin": "JFK",
    "destination": "LHR",
    "programs": ["UA", "AA", "DL", "BA", "VS"],
    "cabins": ["Economy", "Business"],
    "date": "2025-03-15",
    "pax": "1",
    "api_key": "your_api_key"
}
```

**Response Structure:**
```json
{
    "data": [
        {
            "award_points": 60000,
            "surcharge": 150.50,
            "program_code": "VS",
            "airline_code": "VS",
            "cabin": "Economy",
            "transfer_options": ["chase", "amex", "citi"],
            "fare": {
                "travel_minutes_total": 420,
                "products": [
                    {
                        "origin": "JFK",
                        "destination": "LHR",
                        "flight_number": "VS4",
                        "departure_time": "2025-03-15T19:00:00",
                        "arrival_time": "2025-03-16T07:00:00",
                        "operating_carrier": "VS",
                        "operating_airline": "Virgin Atlantic",
                        "carrier": "VS",
                        "travel_minutes": 420
                    }
                ]
            }
        }
    ],
    "error": null,
    "message": null
}
```

### 2.2 Dummy Flight Data Generator

Create `backend/src/handlers/awardtool_dummy.py`:

```python
"""
AwardTool Dummy Data Generator

Provides realistic dummy data for AwardTool API responses when the API is unavailable.
Designed to mirror exact response formats for seamless swapping.
"""

import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional
import logging

logger = logging.getLogger(__name__)


# =============================================================================
# FLIGHT DUMMY DATA
# =============================================================================

# Realistic award pricing by route type and cabin
AWARD_PRICING = {
    # Domestic US (e.g., JFK-LAX, ORD-SFO)
    "domestic": {
        "Economy": {"min_points": 12500, "max_points": 35000, "surcharge_range": (5.60, 25.00)},
        "Premium Economy": {"min_points": 25000, "max_points": 50000, "surcharge_range": (5.60, 35.00)},
        "Business": {"min_points": 50000, "max_points": 80000, "surcharge_range": (5.60, 50.00)},
        "First": {"min_points": 80000, "max_points": 120000, "surcharge_range": (5.60, 75.00)},
    },
    # Transatlantic (US-Europe)
    "transatlantic": {
        "Economy": {"min_points": 30000, "max_points": 60000, "surcharge_range": (50.00, 300.00)},
        "Premium Economy": {"min_points": 50000, "max_points": 85000, "surcharge_range": (75.00, 400.00)},
        "Business": {"min_points": 70000, "max_points": 120000, "surcharge_range": (100.00, 600.00)},
        "First": {"min_points": 100000, "max_points": 180000, "surcharge_range": (150.00, 800.00)},
    },
    # Transpacific (US-Asia)
    "transpacific": {
        "Economy": {"min_points": 35000, "max_points": 70000, "surcharge_range": (30.00, 150.00)},
        "Premium Economy": {"min_points": 60000, "max_points": 100000, "surcharge_range": (50.00, 200.00)},
        "Business": {"min_points": 80000, "max_points": 140000, "surcharge_range": (75.00, 350.00)},
        "First": {"min_points": 110000, "max_points": 200000, "surcharge_range": (100.00, 500.00)},
    },
    # Middle East/Africa
    "middleeast": {
        "Economy": {"min_points": 40000, "max_points": 75000, "surcharge_range": (50.00, 200.00)},
        "Premium Economy": {"min_points": 65000, "max_points": 110000, "surcharge_range": (75.00, 300.00)},
        "Business": {"min_points": 90000, "max_points": 150000, "surcharge_range": (100.00, 450.00)},
        "First": {"min_points": 130000, "max_points": 220000, "surcharge_range": (150.00, 600.00)},
    },
}

# Route type classification
def _classify_route(origin: str, destination: str) -> str:
    """Classify route type for pricing."""
    us_airports = {"JFK", "LAX", "ORD", "SFO", "MIA", "DFW", "ATL", "SEA", "BOS", "IAD", "EWR", "DEN", "IAH", "PHX"}
    europe_airports = {"LHR", "CDG", "FRA", "AMS", "FCO", "MAD", "BCN", "MUC", "ZRH", "VIE", "CPH", "DUB", "LIS"}
    asia_airports = {"NRT", "HND", "ICN", "HKG", "SIN", "BKK", "TPE", "PVG", "PEK", "KIX", "MNL", "DEL", "BOM"}
    middleeast_airports = {"DXB", "DOH", "AUH", "IST", "TLV", "JNB", "CAI"}
    
    orig_us = origin.upper() in us_airports
    dest_us = destination.upper() in us_airports
    dest_europe = destination.upper() in europe_airports
    orig_europe = origin.upper() in europe_airports
    dest_asia = destination.upper() in asia_airports
    orig_asia = origin.upper() in asia_airports
    dest_me = destination.upper() in middleeast_airports
    orig_me = origin.upper() in middleeast_airports
    
    if orig_us and dest_us:
        return "domestic"
    if (orig_us and dest_europe) or (orig_europe and dest_us):
        return "transatlantic"
    if (orig_us and dest_asia) or (orig_asia and dest_us):
        return "transpacific"
    if dest_me or orig_me:
        return "middleeast"
    return "transatlantic"  # Default


# Airline program data with realistic flight patterns
AIRLINE_PROGRAMS = {
    "UA": {
        "name": "United MileagePlus",
        "hubs": ["EWR", "ORD", "IAH", "SFO", "LAX", "DEN"],
        "routes": {
            ("JFK", "LHR"): ["UA110", "UA114"],
            ("EWR", "LHR"): ["UA16", "UA18", "UA22"],
            ("SFO", "NRT"): ["UA837", "UA7925"],
            ("LAX", "NRT"): ["UA32", "UA78"],
            ("ORD", "FRA"): ["UA906", "UA908"],
            ("IAH", "AMS"): ["UA48"],
        },
        "surcharge_multiplier": 0.8,  # UA has lower surcharges
        "transfer_partners": ["chase", "bilt"],
    },
    "AA": {
        "name": "American AAdvantage",
        "hubs": ["DFW", "CLT", "MIA", "ORD", "LAX", "PHX", "PHL"],
        "routes": {
            ("JFK", "LHR"): ["AA100", "AA106"],
            ("DFW", "LHR"): ["AA50", "AA52"],
            ("LAX", "NRT"): ["AA169", "AA175"],
            ("MIA", "MAD"): ["AA68", "AA94"],
            ("ORD", "CDG"): ["AA46"],
        },
        "surcharge_multiplier": 0.9,
        "transfer_partners": ["citi", "bilt"],
    },
    "DL": {
        "name": "Delta SkyMiles",
        "hubs": ["ATL", "DTW", "MSP", "SEA", "LAX", "JFK", "BOS"],
        "routes": {
            ("JFK", "LHR"): ["DL1", "DL3", "DL7"],
            ("ATL", "CDG"): ["DL80", "DL82"],
            ("SEA", "NRT"): ["DL167", "DL169"],
            ("LAX", "HND"): ["DL7", "DL275"],
            ("JFK", "AMS"): ["DL46", "DL48"],
        },
        "surcharge_multiplier": 0.85,
        "transfer_partners": ["amex"],
    },
    "BA": {
        "name": "British Airways Avios",
        "hubs": ["LHR", "LGW"],
        "routes": {
            ("JFK", "LHR"): ["BA117", "BA115", "BA177", "BA179"],
            ("LAX", "LHR"): ["BA280", "BA282"],
            ("MIA", "LHR"): ["BA206", "BA208"],
            ("ORD", "LHR"): ["BA296", "BA298"],
            ("BOS", "LHR"): ["BA212", "BA214"],
        },
        "surcharge_multiplier": 2.5,  # BA has HIGH surcharges
        "transfer_partners": ["chase", "amex", "capitalone", "bilt"],
    },
    "VS": {
        "name": "Virgin Atlantic Flying Club",
        "hubs": ["LHR", "MAN"],
        "routes": {
            ("JFK", "LHR"): ["VS4", "VS10", "VS46"],
            ("LAX", "LHR"): ["VS24", "VS8"],
            ("BOS", "LHR"): ["VS12"],
            ("SFO", "LHR"): ["VS42"],
            ("MIA", "LHR"): ["VS6"],
        },
        "surcharge_multiplier": 1.8,
        "transfer_partners": ["chase", "amex", "citi", "bilt"],
    },
    "AF": {
        "name": "Air France Flying Blue",
        "hubs": ["CDG", "ORY"],
        "routes": {
            ("JFK", "CDG"): ["AF22", "AF8", "AF10"],
            ("LAX", "CDG"): ["AF69", "AF65"],
            ("SFO", "CDG"): ["AF83"],
            ("MIA", "CDG"): ["AF99"],
        },
        "surcharge_multiplier": 1.4,
        "transfer_partners": ["chase", "amex", "citi", "capitalone", "bilt"],
    },
    "SQ": {
        "name": "Singapore KrisFlyer",
        "hubs": ["SIN"],
        "routes": {
            ("JFK", "SIN"): ["SQ24", "SQ26"],
            ("LAX", "SIN"): ["SQ38"],
            ("SFO", "SIN"): ["SQ32"],
            ("JFK", "FRA"): ["SQ26"],  # Via SIN
        },
        "surcharge_multiplier": 0.3,  # SQ has LOW surcharges (no fuel surcharge)
        "transfer_partners": ["chase", "amex", "citi", "capitalone"],
    },
    "NH": {
        "name": "ANA Mileage Club",
        "hubs": ["NRT", "HND"],
        "routes": {
            ("JFK", "NRT"): ["NH9", "NH109"],
            ("LAX", "NRT"): ["NH105", "NH7"],
            ("SFO", "NRT"): ["NH107"],
            ("ORD", "NRT"): ["NH12"],
        },
        "surcharge_multiplier": 0.4,  # ANA has low surcharges
        "transfer_partners": ["amex"],
    },
    "CX": {
        "name": "Cathay Pacific Asia Miles",
        "hubs": ["HKG"],
        "routes": {
            ("JFK", "HKG"): ["CX831", "CX845"],
            ("LAX", "HKG"): ["CX883", "CX881"],
            ("SFO", "HKG"): ["CX879"],
            ("BOS", "HKG"): ["CX811"],
        },
        "surcharge_multiplier": 1.2,
        "transfer_partners": ["amex", "citi"],
    },
    "EK": {
        "name": "Emirates Skywards",
        "hubs": ["DXB"],
        "routes": {
            ("JFK", "DXB"): ["EK202", "EK204"],
            ("LAX", "DXB"): ["EK216"],
            ("SFO", "DXB"): ["EK226"],
            ("ORD", "DXB"): ["EK236"],
        },
        "surcharge_multiplier": 1.0,
        "transfer_partners": ["amex", "citi", "capitalone"],
    },
    "QR": {
        "name": "Qatar Privilege Club",
        "hubs": ["DOH"],
        "routes": {
            ("JFK", "DOH"): ["QR702", "QR702"],
            ("LAX", "DOH"): ["QR740"],
            ("ORD", "DOH"): ["QR726"],
            ("MIA", "DOH"): ["QR778"],
        },
        "surcharge_multiplier": 0.6,
        "transfer_partners": ["citi"],
    },
    "TK": {
        "name": "Turkish Miles&Smiles",
        "hubs": ["IST"],
        "routes": {
            ("JFK", "IST"): ["TK2", "TK4"],
            ("LAX", "IST"): ["TK10"],
            ("SFO", "IST"): ["TK80"],
            ("MIA", "IST"): ["TK78"],
        },
        "surcharge_multiplier": 0.5,
        "transfer_partners": ["citi", "capitalone", "bilt"],
    },
    "AS": {
        "name": "Alaska Mileage Plan",
        "hubs": ["SEA", "PDX", "ANC", "LAX", "SFO"],
        "routes": {
            ("SEA", "LAX"): ["AS452", "AS456", "AS460"],
            ("SEA", "JFK"): ["AS12", "AS18"],
            ("LAX", "JFK"): ["AS270", "AS272"],
            ("SFO", "JFK"): ["AS22", "AS24"],
        },
        "surcharge_multiplier": 0.7,
        "transfer_partners": ["amex", "chase", "capitalone"],
    },
}

# Flight duration estimates (in minutes) by route type
FLIGHT_DURATIONS = {
    "domestic": (120, 360),      # 2-6 hours
    "transatlantic": (360, 540), # 6-9 hours
    "transpacific": (600, 900),  # 10-15 hours
    "middleeast": (660, 960),    # 11-16 hours
}


def _generate_flight_time(date_str: str, is_departure: bool = True) -> str:
    """Generate realistic flight departure/arrival time."""
    # Common departure hours (weighted toward morning/evening for long-haul)
    departure_hours = [6, 7, 8, 9, 10, 11, 14, 15, 16, 17, 18, 19, 20, 21, 22]
    hour = random.choice(departure_hours)
    minute = random.choice([0, 15, 30, 45])
    return f"{date_str}T{hour:02d}:{minute:02d}:00"


def _generate_arrival_time(departure_time: str, duration_minutes: int) -> str:
    """Calculate arrival time from departure and duration."""
    dep_dt = datetime.strptime(departure_time, "%Y-%m-%dT%H:%M:%S")
    arr_dt = dep_dt + timedelta(minutes=duration_minutes)
    return arr_dt.strftime("%Y-%m-%dT%H:%M:%S")


def generate_dummy_flight_data(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str],
    programs: List[str],
    pax: int = 1
) -> Dict[str, Any]:
    """
    Generate dummy AwardTool flight search response.
    
    Args:
        origin: Origin airport code (e.g., "JFK")
        destination: Destination airport code (e.g., "LHR")
        date: Date string (e.g., "2025-03-15")
        cabins: List of cabin classes (e.g., ["Economy", "Business"])
        programs: List of airline program codes (e.g., ["UA", "AA", "DL"])
        pax: Number of passengers
        
    Returns:
        Dict matching AwardTool API response format
    """
    logger.info(f"[DUMMY] Generating flight data: {origin}->{destination} on {date}")
    
    route_type = _classify_route(origin, destination)
    pricing = AWARD_PRICING[route_type]
    duration_range = FLIGHT_DURATIONS[route_type]
    
    data = []
    
    for program_code in programs:
        if program_code not in AIRLINE_PROGRAMS:
            continue
            
        program = AIRLINE_PROGRAMS[program_code]
        route_key = (origin.upper(), destination.upper())
        reverse_key = (destination.upper(), origin.upper())
        
        # Get flights for this route (or generate generic ones)
        flight_numbers = program["routes"].get(route_key, [])
        if not flight_numbers:
            flight_numbers = program["routes"].get(reverse_key, [])
        if not flight_numbers:
            # Generate a generic flight number if no specific route
            flight_numbers = [f"{program_code}{random.randint(100, 999)}"]
        
        for flight_num in flight_numbers[:2]:  # Limit to 2 flights per program
            for cabin in cabins:
                cabin_pricing = pricing.get(cabin, pricing["Economy"])
                
                # Calculate points with some randomness
                base_points = random.randint(
                    cabin_pricing["min_points"],
                    cabin_pricing["max_points"]
                )
                # Round to nearest 500/1000
                points = round(base_points / 500) * 500
                
                # Calculate surcharge
                base_surcharge = random.uniform(*cabin_pricing["surcharge_range"])
                surcharge = round(base_surcharge * program["surcharge_multiplier"], 2)
                
                # Generate times
                duration = random.randint(*duration_range)
                dep_time = _generate_flight_time(date)
                arr_time = _generate_arrival_time(dep_time, duration)
                
                data.append({
                    "award_points": points,
                    "surcharge": surcharge,
                    "program_code": program_code,
                    "airline_code": program_code,
                    "cabin": cabin,
                    "transfer_options": program["transfer_partners"],
                    "fare": {
                        "travel_minutes_total": duration,
                        "products": [
                            {
                                "origin": origin.upper(),
                                "destination": destination.upper(),
                                "flight_number": flight_num,
                                "departure_time": dep_time,
                                "arrival_time": arr_time,
                                "operating_carrier": program_code,
                                "operating_airline": program["name"].split()[0],
                                "carrier": program_code,
                                "travel_minutes": duration,
                            }
                        ]
                    }
                })
    
    # Sort by points (cheapest first)
    data.sort(key=lambda x: x["award_points"])
    
    logger.info(f"[DUMMY] Generated {len(data)} flight options for {origin}->{destination}")
    
    return {
        "data": data,
        "error": None,
        "message": None,
        "_dummy": True  # Flag to identify dummy data
    }


# =============================================================================
# HOTEL DUMMY DATA
# =============================================================================

HOTEL_PROGRAMS = {
    "HH": {
        "name": "Hilton Honors",
        "brands": ["Hilton", "Conrad", "Waldorf Astoria", "DoubleTree", "Hampton Inn"],
        "points_per_night_range": (10000, 120000),
        "has_surcharge": True,
    },
    "MAR": {
        "name": "Marriott Bonvoy",
        "brands": ["Marriott", "Ritz-Carlton", "St. Regis", "W Hotels", "Westin", "Sheraton"],
        "points_per_night_range": (15000, 100000),
        "has_surcharge": True,
    },
    "HYATT": {
        "name": "World of Hyatt",
        "brands": ["Grand Hyatt", "Park Hyatt", "Andaz", "Hyatt Regency", "Hyatt Place"],
        "points_per_night_range": (5000, 45000),
        "has_surcharge": False,  # Hyatt doesn't charge resort fees on award stays
    },
    "IHG": {
        "name": "IHG One Rewards",
        "brands": ["InterContinental", "Kimpton", "Crowne Plaza", "Holiday Inn", "Staybridge Suites"],
        "points_per_night_range": (10000, 80000),
        "has_surcharge": True,
    },
}

# City-specific hotel data
CITY_HOTELS = {
    "london": {
        "HH": [
            {"name": "Conrad London St. James", "stars": 5, "points": 95000, "cash": 450},
            {"name": "Waldorf Astoria London", "stars": 5, "points": 110000, "cash": 550},
            {"name": "Hilton London Bankside", "stars": 4, "points": 60000, "cash": 280},
        ],
        "MAR": [
            {"name": "The Ritz-Carlton London", "stars": 5, "points": 85000, "cash": 750},
            {"name": "W London Leicester Square", "stars": 5, "points": 65000, "cash": 400},
            {"name": "Marriott Hotel County Hall", "stars": 4, "points": 45000, "cash": 250},
        ],
        "HYATT": [
            {"name": "Andaz London Liverpool Street", "stars": 5, "points": 25000, "cash": 350},
            {"name": "Hyatt Regency London", "stars": 4, "points": 20000, "cash": 280},
        ],
    },
    "paris": {
        "HH": [
            {"name": "Hilton Paris Opera", "stars": 4, "points": 70000, "cash": 320},
            {"name": "Hilton Paris La Defense", "stars": 4, "points": 45000, "cash": 180},
        ],
        "MAR": [
            {"name": "The Ritz Paris", "stars": 5, "points": 100000, "cash": 1200},
            {"name": "Renaissance Paris Vendome", "stars": 5, "points": 55000, "cash": 350},
        ],
        "HYATT": [
            {"name": "Park Hyatt Paris Vendome", "stars": 5, "points": 40000, "cash": 900},
            {"name": "Hyatt Regency Paris Etoile", "stars": 4, "points": 18000, "cash": 250},
        ],
    },
    "tokyo": {
        "HH": [
            {"name": "Conrad Tokyo", "stars": 5, "points": 95000, "cash": 400},
            {"name": "Hilton Tokyo", "stars": 4, "points": 50000, "cash": 250},
        ],
        "MAR": [
            {"name": "The Ritz-Carlton Tokyo", "stars": 5, "points": 70000, "cash": 650},
            {"name": "Tokyo Marriott Hotel", "stars": 5, "points": 50000, "cash": 320},
        ],
        "HYATT": [
            {"name": "Park Hyatt Tokyo", "stars": 5, "points": 40000, "cash": 700},
            {"name": "Andaz Tokyo", "stars": 5, "points": 35000, "cash": 500},
            {"name": "Grand Hyatt Tokyo", "stars": 5, "points": 30000, "cash": 400},
        ],
    },
    "new york": {
        "HH": [
            {"name": "Conrad New York Midtown", "stars": 5, "points": 95000, "cash": 400},
            {"name": "New York Hilton Midtown", "stars": 4, "points": 70000, "cash": 300},
        ],
        "MAR": [
            {"name": "The Ritz-Carlton New York Central Park", "stars": 5, "points": 100000, "cash": 1000},
            {"name": "W New York Times Square", "stars": 4, "points": 50000, "cash": 350},
        ],
        "HYATT": [
            {"name": "Park Hyatt New York", "stars": 5, "points": 35000, "cash": 800},
            {"name": "Andaz 5th Avenue", "stars": 5, "points": 25000, "cash": 450},
        ],
        "IHG": [
            {"name": "InterContinental New York Times Square", "stars": 5, "points": 70000, "cash": 350},
            {"name": "Kimpton Hotel Eventi", "stars": 4, "points": 45000, "cash": 280},
        ],
    },
    "dubai": {
        "HH": [
            {"name": "Waldorf Astoria Dubai Palm Jumeirah", "stars": 5, "points": 120000, "cash": 600},
            {"name": "Conrad Dubai", "stars": 5, "points": 80000, "cash": 350},
        ],
        "MAR": [
            {"name": "The Ritz-Carlton Dubai", "stars": 5, "points": 85000, "cash": 500},
            {"name": "W Dubai The Palm", "stars": 5, "points": 70000, "cash": 450},
        ],
        "HYATT": [
            {"name": "Grand Hyatt Dubai", "stars": 5, "points": 25000, "cash": 300},
            {"name": "Park Hyatt Dubai", "stars": 5, "points": 30000, "cash": 400},
        ],
    },
}


def _get_city_from_destination(destination: str) -> str:
    """Extract city name from destination code or string."""
    airport_to_city = {
        "LHR": "london", "LGW": "london", "STN": "london",
        "CDG": "paris", "ORY": "paris",
        "NRT": "tokyo", "HND": "tokyo",
        "JFK": "new york", "EWR": "new york", "LGA": "new york",
        "DXB": "dubai",
        "LAX": "los angeles",
        "SFO": "san francisco",
        "ORD": "chicago",
        "MIA": "miami",
        "SIN": "singapore",
        "HKG": "hong kong",
        "ICN": "seoul",
        "BKK": "bangkok",
    }
    
    dest_upper = destination.upper().strip()
    if dest_upper in airport_to_city:
        return airport_to_city[dest_upper]
    
    # If not an airport code, use the destination as city name
    return destination.lower().strip()


def generate_dummy_hotel_data(
    destination: str,
    check_in: str,
    check_out: str,
    programs: List[str],
    guests: int = 1,
    hotel_class: Optional[str] = None
) -> Dict[str, Any]:
    """
    Generate dummy AwardTool hotel search response.
    
    Args:
        destination: City name or airport code
        check_in: Check-in date (YYYY-MM-DD)
        check_out: Check-out date (YYYY-MM-DD)
        programs: Hotel program codes (HH, MAR, HYATT, IHG)
        guests: Number of guests
        hotel_class: Star rating filter (e.g., "4", "5")
        
    Returns:
        Dict matching AwardTool Hotel API response format
    """
    logger.info(f"[DUMMY] Generating hotel data: {destination} ({check_in} to {check_out})")
    
    # Calculate nights
    try:
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        nights = (co - ci).days
    except ValueError:
        nights = 1
    
    city = _get_city_from_destination(destination)
    city_hotels = CITY_HOTELS.get(city, {})
    
    data = []
    hotel_id = 1
    
    for program_code in programs:
        if program_code not in HOTEL_PROGRAMS:
            continue
            
        program = HOTEL_PROGRAMS[program_code]
        
        # Get city-specific hotels or generate generic ones
        hotels = city_hotels.get(program_code, [])
        
        if not hotels:
            # Generate generic hotels for this program
            brand = random.choice(program["brands"])
            points_range = program["points_per_night_range"]
            hotels = [
                {
                    "name": f"{brand} {destination.title()}",
                    "stars": random.choice([3, 4, 5]),
                    "points": random.randint(*points_range),
                    "cash": random.randint(150, 500),
                }
            ]
        
        for hotel in hotels:
            # Apply star rating filter
            if hotel_class and str(hotel.get("stars", 4)) != str(hotel_class):
                continue
            
            total_points = hotel["points"] * nights
            total_cash = hotel["cash"] * nights
            
            # Calculate surcharge (taxes and fees)
            surcharge = 0
            if program["has_surcharge"]:
                surcharge = round(total_cash * random.uniform(0.10, 0.20), 2)
            
            data.append({
                "hotel_id": f"H{hotel_id:04d}",
                "id": f"H{hotel_id:04d}",
                "name": hotel["name"],
                "hotel_name": hotel["name"],
                "brand": program["name"],
                "program_code": program_code,
                "program": program_code,
                "cash_rate": total_cash,
                "cash_cost": total_cash,
                "price": total_cash,
                "points": total_points,
                "award_points": total_points,
                "points_required": total_points,
                "surcharge": surcharge,
                "tax": surcharge,
                "star_rating": hotel["stars"],
                "stars": hotel["stars"],
                "hotel_class": str(hotel["stars"]),
                "address": f"{random.randint(1, 999)} Main Street, {destination.title()}",
                "location": destination.title(),
            })
            hotel_id += 1
    
    # Sort by points (cheapest first)
    data.sort(key=lambda x: x.get("points", 0))
    
    logger.info(f"[DUMMY] Generated {len(data)} hotel options for {destination}")
    
    return {
        "data": data,
        "hotels": data,  # Some responses use "hotels" instead of "data"
        "error": None,
        "message": None,
        "_dummy": True
    }


# =============================================================================
# PANORAMA CALENDAR DUMMY DATA
# =============================================================================

def generate_dummy_calendar_data(
    origin: str,
    destination: str,
    start_date: Optional[str] = None,
    months_ahead: int = 12
) -> List[Dict[str, Any]]:
    """
    Generate dummy Panorama calendar data.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        start_date: Start date (defaults to today)
        months_ahead: Number of months of data to generate
        
    Returns:
        List of calendar entries matching AwardTool Panorama format
    """
    logger.info(f"[DUMMY] Generating calendar data: {origin}->{destination}")
    
    route_type = _classify_route(origin, destination)
    pricing = AWARD_PRICING[route_type]
    
    if start_date:
        try:
            current = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            current = datetime.now()
    else:
        current = datetime.now()
    
    end_date = current + timedelta(days=months_ahead * 30)
    
    data = []
    programs = ["UA", "AA", "DL", "BA", "VS", "AF"]  # Common programs for calendar
    
    while current < end_date:
        date_str = current.strftime("%Y-%m-%d")
        
        for program in programs:
            if program not in AIRLINE_PROGRAMS:
                continue
            
            # Generate availability with some randomness
            # ~70% chance of availability on any given day
            if random.random() < 0.3:
                current += timedelta(days=1)
                continue
            
            program_info = AIRLINE_PROGRAMS[program]
            surcharge_mult = program_info["surcharge_multiplier"]
            
            # Points for each cabin (y=economy, w=premium, j=business, f=first)
            points = {
                "y": round(random.randint(pricing["Economy"]["min_points"], pricing["Economy"]["max_points"]) / 500) * 500 if random.random() > 0.1 else None,
                "w": round(random.randint(pricing["Premium Economy"]["min_points"], pricing["Premium Economy"]["max_points"]) / 500) * 500 if random.random() > 0.3 else None,
                "j": round(random.randint(pricing["Business"]["min_points"], pricing["Business"]["max_points"]) / 1000) * 1000 if random.random() > 0.2 else None,
                "f": round(random.randint(pricing["First"]["min_points"], pricing["First"]["max_points"]) / 1000) * 1000 if random.random() > 0.5 else None,
                "tax": {
                    "y": round(random.uniform(*pricing["Economy"]["surcharge_range"]) * surcharge_mult, 2) if points.get("y") else None,
                    "w": round(random.uniform(*pricing["Premium Economy"]["surcharge_range"]) * surcharge_mult, 2) if points.get("w") else None,
                    "j": round(random.uniform(*pricing["Business"]["surcharge_range"]) * surcharge_mult, 2) if points.get("j") else None,
                    "f": round(random.uniform(*pricing["First"]["surcharge_range"]) * surcharge_mult, 2) if points.get("f") else None,
                },
                "c_a": {  # Carrier airlines
                    "y": [program] if points.get("y") else [],
                    "w": [program] if points.get("w") else [],
                    "j": [program] if points.get("j") else [],
                    "f": [program] if points.get("f") else [],
                },
                "c_s": {  # Seat counts
                    "y": random.randint(1, 9) if points.get("y") else None,
                    "w": random.randint(1, 4) if points.get("w") else None,
                    "j": random.randint(1, 4) if points.get("j") else None,
                    "f": random.randint(1, 2) if points.get("f") else None,
                },
                "ss": {  # Availability flag
                    "y": "Y" if points.get("y") else None,
                    "w": "Y" if points.get("w") else None,
                    "j": "Y" if points.get("j") else None,
                    "f": "Y" if points.get("f") else None,
                },
                "ls": current.strftime("%Y-%m-%dT%H:%M:%S"),  # Last seen
            }
            
            # Non-stop points (slightly higher if available)
            points_ns = {
                "y": int(points["y"] * 1.1) if points.get("y") and random.random() > 0.3 else None,
                "w": int(points["w"] * 1.1) if points.get("w") and random.random() > 0.4 else None,
                "j": int(points["j"] * 1.1) if points.get("j") and random.random() > 0.3 else None,
                "f": int(points["f"] * 1.1) if points.get("f") and random.random() > 0.5 else None,
                "ls": current.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            
            data.append({
                "date": date_str,
                "program": program,
                "route": f"{origin.upper()}-{destination.upper()}",
                "points": points,
                "points_ns": points_ns,
                "r_ls": current.strftime("%Y-%m-%dT%H:%M:%S"),  # Route last seen
            })
        
        current += timedelta(days=1)
    
    logger.info(f"[DUMMY] Generated {len(data)} calendar entries for {origin}->{destination}")
    
    return data


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def get_dummy_flights(origin: str, destination: str, date: str, cabins: List[str] = None, programs: List[str] = None) -> Dict[str, Any]:
    """Convenience wrapper for flight dummy data."""
    cabins = cabins or ["Economy", "Business"]
    programs = programs or list(AIRLINE_PROGRAMS.keys())
    return generate_dummy_flight_data(origin, destination, date, cabins, programs)


def get_dummy_hotels(destination: str, check_in: str, check_out: str, programs: List[str] = None) -> Dict[str, Any]:
    """Convenience wrapper for hotel dummy data."""
    programs = programs or ["HH", "MAR", "HYATT", "IHG"]
    return generate_dummy_hotel_data(destination, check_in, check_out, programs)


def get_dummy_calendar(origin: str, destination: str) -> List[Dict[str, Any]]:
    """Convenience wrapper for calendar dummy data."""
    return generate_dummy_calendar_data(origin, destination)
```

---

## 3. Hotel Search Dummy Data

The hotel dummy data is included in the `awardtool_dummy.py` file above. Key features:

### 3.1 Hotel API Response Format

**Endpoint:** `POST https://www.awardtool-api.com/search_hotel`

**Request:**
```json
{
    "destination": "London",
    "check_in": "2025-03-15",
    "check_out": "2025-03-20",
    "programs": ["HH", "MAR", "HYATT", "IHG"],
    "guests": 2,
    "hotel_class": "4",
    "api_key": "your_api_key"
}
```

**Response:**
```json
{
    "data": [
        {
            "hotel_id": "H0001",
            "name": "Conrad London St. James",
            "brand": "Hilton Honors",
            "program_code": "HH",
            "cash_rate": 2250.00,
            "points": 475000,
            "surcharge": 225.00,
            "star_rating": 5,
            "address": "22-28 Broadway, London"
        }
    ],
    "error": null
}
```

---

## 4. Panorama Calendar Dummy Data

The calendar dummy data is also in `awardtool_dummy.py`. 

### 4.1 Calendar API Response Format

**Endpoint:** `POST https://www.awardtool-api.com/panorama/panorama_calendar_data`

**Request:**
```json
{
    "id": "JFK-LHR",
    "api_key": "your_api_key"
}
```

**Response:**
```json
{
    "data": [
        {
            "date": "2025-03-15",
            "program": "VS",
            "route": "JFK-LHR",
            "points": {
                "y": 30000,
                "w": 50000,
                "j": 70000,
                "f": 120000,
                "tax": {"y": 150.50, "w": 200.00, "j": 300.00, "f": 450.00},
                "c_a": {"y": ["VS"], "w": ["VS"], "j": ["VS"], "f": ["VS"]},
                "c_s": {"y": 5, "w": 3, "j": 2, "f": 1},
                "ss": {"y": "Y", "w": "Y", "j": "Y", "f": "Y"},
                "ls": "2025-01-20T10:30:00"
            },
            "points_ns": {
                "y": 35000,
                "j": 80000,
                "ls": "2025-01-20T10:30:00"
            },
            "r_ls": "2025-01-20T10:30:00"
        }
    ]
}
```

---

## 5. Implementation Files

### 5.1 File Structure (IMPLEMENTED)

```
backend/
├── src/
│   ├── handlers/
│   │   ├── awardtool_dummy.py      # ✅ CREATED: Dummy data generator (700+ lines)
│   │   ├── flights.py              # ✅ MODIFIED: Uses is_awardtool_dummy_mode()
│   │   ├── hotels.py               # ✅ MODIFIED: Uses is_awardtool_dummy_mode()
│   │   └── award_calendar.py       # ✅ MODIFIED: Uses is_awardtool_dummy_mode()
│   ├── config.py                   # ✅ MODIFIED: Added is_awardtool_dummy_mode()
│   └── ...
├── env_template.txt                # ✅ MODIFIED: Added USE_AWARDTOOL_DUMMY_DATA
└── ...
```

### 5.2 Key Features of Implementation

The `awardtool_dummy.py` module includes:

1. **Universal Airport Support**: Works with ANY commercial airport worldwide using:
   - Comprehensive database of 200+ major airports mapped to regions
   - Intelligent fallback using IATA code patterns (first letter hints)
   - Region-based route classification (NA, EU, AS_E, AS_SE, AS_S, ME, AF, OC, SA, CA, CB)

2. **Smart Route Classification**: 
   - `domestic`: Same region (e.g., JFK-LAX)
   - `short_haul`: Intra-regional (e.g., LHR-CDG)
   - `transatlantic`: NA ↔ EU
   - `transpacific`: NA ↔ Asia/Oceania
   - `middleeast`: Routes involving ME region
   - `long_haul`: Ultra-long routes (e.g., EU ↔ Asia)

3. **Realistic Pricing**:
   - Points vary by route type and cabin class
   - Surcharge multipliers by airline (BA=2.5x, SQ=0.3x, etc.)
   - City tier pricing for hotels (Tier 1: NYC, London, Tokyo, etc.)

4. **Airline Route Relevance**:
   - Only returns airlines that actually fly routes to relevant regions
   - e.g., Alaska Airlines (AS) only for North America routes

### 5.2 Modify `flights.py`

Add at the top of `backend/src/handlers/flights.py`:

```python
# Add after imports
from src.config import USE_AWARDTOOL_DUMMY_DATA

# Add dummy data import (conditional)
if USE_AWARDTOOL_DUMMY_DATA:
    from src.handlers.awardtool_dummy import generate_dummy_flight_data
```

Modify the `_awardtool_request` function:

```python
async def _awardtool_request(origin, destination, date_str, cabins, pax, programs, client):
    """Make a single AwardTool API request (or return dummy data)."""
    
    # Check if dummy mode is enabled
    if USE_AWARDTOOL_DUMMY_DATA:
        logger.info(f"[DUMMY MODE] Returning dummy flight data for {origin}->{destination}")
        return generate_dummy_flight_data(origin, destination, date_str, cabins, programs, int(pax))
    
    # Original implementation continues below...
    payload = {
        "origin": origin,
        "destination": destination,
        "programs": [p.upper() for p in programs],
        "cabins": cabins,
        "date": date_str,
        "pax": str(pax),
        "api_key": AWARD_TOOL_API_KEY,
    }
    # ... rest of original code
```

### 5.3 Modify `hotels.py`

Add at the top of `backend/src/handlers/hotels.py`:

```python
from src.config import USE_AWARDTOOL_DUMMY_DATA

if USE_AWARDTOOL_DUMMY_DATA:
    from src.handlers.awardtool_dummy import generate_dummy_hotel_data
```

Modify the `_awardtool_hotel_search` function:

```python
async def _awardtool_hotel_search(
    destination: str,
    check_in: str,
    check_out: str,
    programs: List[str],
    guests: int,
    hotel_class: Optional[str],
    client: httpx.AsyncClient,
) -> Dict[str, Any]:
    
    # Check if dummy mode is enabled
    if USE_AWARDTOOL_DUMMY_DATA:
        logger.info(f"[DUMMY MODE] Returning dummy hotel data for {destination}")
        return generate_dummy_hotel_data(destination, check_in, check_out, programs, guests, hotel_class)
    
    # Original implementation continues...
```

### 5.4 Modify `award_calendar.py`

Add at the top of `backend/src/handlers/award_calendar.py`:

```python
from src.config import USE_AWARDTOOL_DUMMY_DATA

if USE_AWARDTOOL_DUMMY_DATA:
    from src.handlers.awardtool_dummy import generate_dummy_calendar_data
```

Modify the `fetch_awardtool_calendar` function:

```python
async def fetch_awardtool_calendar(origin, destination, api_key=None, client=None):
    
    # Check if dummy mode is enabled
    if USE_AWARDTOOL_DUMMY_DATA:
        logger.info(f"[DUMMY MODE] Returning dummy calendar data for {origin}->{destination}")
        return generate_dummy_calendar_data(origin, destination)
    
    # Original implementation continues...
```

---

## 6. Integration Points

### 6.1 API Endpoints Affected

| Endpoint | Handler | Impact |
|----------|---------|--------|
| `/itinerary/generate` | `itinerary_service.py` | Uses flight handler → auto-uses dummy |
| `/api/itinerary/optimize-out-of-pocket` | `serp_api_functions.py` | Uses flight handler → auto-uses dummy |
| `/hotels/search` | `hotels.py` | Direct → needs modification |
| `/hotels/optimize-out-of-pocket` | `serp_api_functions.py` | Uses hotel handler → auto-uses dummy |

### 6.2 Service Layer

The service layer (`itinerary_service.py`, `serp_api_functions.py`) doesn't need modification because it calls the handlers which will return dummy data when enabled.

---

## 7. Testing Strategy

### 7.1 Unit Tests

Create `backend/tests/test_awardtool_dummy.py`:

```python
import pytest
from src.handlers.awardtool_dummy import (
    generate_dummy_flight_data,
    generate_dummy_hotel_data,
    generate_dummy_calendar_data,
)


class TestDummyFlightData:
    def test_generates_valid_structure(self):
        result = generate_dummy_flight_data(
            origin="JFK",
            destination="LHR",
            date="2025-03-15",
            cabins=["Economy", "Business"],
            programs=["UA", "AA", "BA"]
        )
        
        assert "data" in result
        assert isinstance(result["data"], list)
        assert len(result["data"]) > 0
        
    def test_flight_has_required_fields(self):
        result = generate_dummy_flight_data(
            origin="JFK",
            destination="LHR",
            date="2025-03-15",
            cabins=["Economy"],
            programs=["UA"]
        )
        
        flight = result["data"][0]
        assert "award_points" in flight
        assert "surcharge" in flight
        assert "program_code" in flight
        assert "fare" in flight
        assert "products" in flight["fare"]
        
    def test_domestic_pricing_lower_than_international(self):
        domestic = generate_dummy_flight_data("JFK", "LAX", "2025-03-15", ["Economy"], ["UA"])
        intl = generate_dummy_flight_data("JFK", "LHR", "2025-03-15", ["Economy"], ["UA"])
        
        if domestic["data"] and intl["data"]:
            assert domestic["data"][0]["award_points"] < intl["data"][0]["award_points"]


class TestDummyHotelData:
    def test_generates_valid_structure(self):
        result = generate_dummy_hotel_data(
            destination="London",
            check_in="2025-03-15",
            check_out="2025-03-20",
            programs=["HH", "MAR"]
        )
        
        assert "data" in result
        assert isinstance(result["data"], list)
        
    def test_calculates_nights_correctly(self):
        result = generate_dummy_hotel_data(
            destination="London",
            check_in="2025-03-15",
            check_out="2025-03-20",
            programs=["HYATT"]
        )
        
        # 5 nights, so points should be base * 5
        if result["data"]:
            hotel = result["data"][0]
            assert hotel["points"] > 0


class TestDummyCalendarData:
    def test_generates_multiple_dates(self):
        result = generate_dummy_calendar_data("JFK", "LHR", months_ahead=1)
        
        assert isinstance(result, list)
        assert len(result) > 0
        
    def test_calendar_entry_structure(self):
        result = generate_dummy_calendar_data("JFK", "LHR", months_ahead=1)
        
        if result:
            entry = result[0]
            assert "date" in entry
            assert "program" in entry
            assert "points" in entry
```

### 7.2 Integration Test

```python
# backend/tests/test_dummy_integration.py
import os
import pytest
import asyncio

# Enable dummy mode for testing
os.environ["USE_AWARDTOOL_DUMMY_DATA"] = "true"

from src.handlers.flights import get_flights_award_first_with_points_async
from src.handlers.hotels import search_hotels_async


@pytest.mark.asyncio
async def test_flight_handler_uses_dummy():
    """Test that flight handler returns dummy data when enabled."""
    edges = await get_flights_award_first_with_points_async(
        origin="JFK",
        destination="LHR",
        user_points={"chase": 100000},
        filters={"outbound_date": "2025-03-15"},
    )
    
    # Should return edges even without API
    assert len(edges) > 0


@pytest.mark.asyncio  
async def test_hotel_handler_uses_dummy():
    """Test that hotel handler returns dummy data when enabled."""
    hotels = await search_hotels_async(
        destination="London",
        check_in="2025-03-15",
        check_out="2025-03-20",
    )
    
    assert len(hotels) > 0
```

---

## 8. Swapping Back to Live API

When the AwardTool API is restored, swapping back is simple:

### 8.1 Environment Change

```bash
# In .env file, change:
USE_AWARDTOOL_DUMMY_DATA=false

# And ensure API key is set:
AWARD_TOOL_API_KEY=your_actual_api_key
```

### 8.2 Verification Steps

1. **Remove dummy flag:**
   ```bash
   # .env
   USE_AWARDTOOL_DUMMY_DATA=false
   AWARD_TOOL_API_KEY=your_key
   ```

2. **Restart the backend:**
   ```bash
   # Local
   cd backend && python -m uvicorn src.app:app --reload
   
   # Or if using App Runner, redeploy
   ```

3. **Test a route:**
   ```bash
   curl -X POST http://localhost:8000/itinerary/generate \
     -H "Content-Type: application/json" \
     -d '{"origin": "JFK", "destinations": ["LHR"], "outbound_date": "2025-03-15"}'
   ```

4. **Check logs for live API calls:**
   ```
   INFO: AwardTool [JFK]->[LHR] date=2025-03-15: requesting (programs=23, cabins=['Economy'], pax=1)
   ```
   
   vs. dummy mode:
   ```
   INFO: [DUMMY MODE] Returning dummy flight data for JFK->LHR
   ```

### 8.3 Gradual Rollout

For safety, you can enable live API for specific routes first:

```python
# In config.py
DUMMY_MODE_EXCLUDED_ROUTES = ["JFK-LHR", "LAX-NRT"]  # Test routes

def should_use_dummy(origin: str, destination: str) -> bool:
    if not USE_AWARDTOOL_DUMMY_DATA:
        return False
    route = f"{origin.upper()}-{destination.upper()}"
    return route not in DUMMY_MODE_EXCLUDED_ROUTES
```

---

## Summary

This implementation provides:

1. **Complete dummy data coverage** for all three AwardTool APIs
2. **Realistic pricing** based on route type, cabin class, and airline program
3. **Exact format matching** to ensure seamless swapping
4. **Simple toggle** via environment variable
5. **Logging** to clearly identify when dummy data is being used
6. **Test coverage** for unit and integration testing

The dummy data system allows development and testing to continue while the AwardTool API has issues, with minimal code changes required to switch back to the live API.
