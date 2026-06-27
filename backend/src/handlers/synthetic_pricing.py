"""
AwardTool Dummy Data Generator

Provides realistic dummy data for AwardTool API responses when the API is unavailable.
Designed to mirror exact response formats for seamless swapping.

Supports ALL commercial airports worldwide using region-based classification.
"""

import random
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
import logging
import math

# Centralized program config (single source of truth)
from src.config.programs import (
    AIRLINE_PROGRAMS_FULL as AIRLINE_PROGRAMS,
    HOTEL_PROGRAMS_FULL as HOTEL_PROGRAMS,
)

logger = logging.getLogger(__name__)


# =============================================================================
# AIRPORT REGION DATABASE
# Comprehensive mapping of airports to regions for route classification
# =============================================================================

# Region definitions for route type classification
REGIONS = {
    "north_america": "NA",
    "europe": "EU", 
    "asia_east": "AS_E",      # Japan, Korea, China, Taiwan, Hong Kong
    "asia_southeast": "AS_SE", # Singapore, Thailand, Vietnam, Philippines, Indonesia, Malaysia
    "asia_south": "AS_S",      # India, Sri Lanka, Bangladesh, Pakistan
    "middle_east": "ME",       # UAE, Qatar, Saudi, Israel, Turkey
    "africa": "AF",
    "oceania": "OC",           # Australia, New Zealand, Pacific Islands
    "south_america": "SA",
    "central_america": "CA",
    "caribbean": "CB",
}

# Airport prefix patterns by region (IATA codes often follow regional patterns)
# This allows classification of ANY airport, not just ones in our database
AIRPORT_PREFIX_REGIONS = {
    # North America - US airports often start with specific letters
    "JFK": "NA", "LAX": "NA", "ORD": "NA", "SFO": "NA", "MIA": "NA", "DFW": "NA",
    "ATL": "NA", "SEA": "NA", "BOS": "NA", "IAD": "NA", "EWR": "NA", "DEN": "NA",
    "IAH": "NA", "PHX": "NA", "DTW": "NA", "MSP": "NA", "CLT": "NA", "PHL": "NA",
    "LGA": "NA", "BWI": "NA", "SAN": "NA", "TPA": "NA", "PDX": "NA", "SLC": "NA",
    "AUS": "NA", "MCO": "NA", "FLL": "NA", "RDU": "NA", "BNA": "NA", "STL": "NA",
    "MCI": "NA", "SMF": "NA", "SJC": "NA", "OAK": "NA", "HNL": "NA", "ANC": "NA",
    # Canada
    "YYZ": "NA", "YVR": "NA", "YUL": "NA", "YYC": "NA", "YOW": "NA", "YEG": "NA",
    "YHZ": "NA", "YWG": "NA", "YQB": "NA",
    # Mexico
    "MEX": "NA", "CUN": "NA", "GDL": "NA", "MTY": "NA", "SJD": "NA", "PVR": "NA",
    
    # Europe
    "LHR": "EU", "LGW": "EU", "STN": "EU", "LTN": "EU", "MAN": "EU", "EDI": "EU",
    "CDG": "EU", "ORY": "EU", "NCE": "EU", "LYS": "EU", "MRS": "EU",
    "FRA": "EU", "MUC": "EU", "TXL": "EU", "BER": "EU", "DUS": "EU", "HAM": "EU",
    "AMS": "EU", "BRU": "EU", "ZRH": "EU", "GVA": "EU", "VIE": "EU",
    "FCO": "EU", "MXP": "EU", "VCE": "EU", "NAP": "EU", "FLR": "EU",
    "MAD": "EU", "BCN": "EU", "PMI": "EU", "AGP": "EU", "IBZ": "EU",
    "LIS": "EU", "OPO": "EU", "DUB": "EU", "SNN": "EU",
    "CPH": "EU", "ARN": "EU", "OSL": "EU", "HEL": "EU",
    "WAW": "EU", "PRG": "EU", "BUD": "EU", "OTP": "EU", "SOF": "EU",
    "ATH": "EU", "SKG": "EU", "ZAG": "EU", "LJU": "EU",
    
    # Asia East
    "NRT": "AS_E", "HND": "AS_E", "KIX": "AS_E", "NGO": "AS_E", "FUK": "AS_E",
    "ICN": "AS_E", "GMP": "AS_E", "PUS": "AS_E",
    "PVG": "AS_E", "PEK": "AS_E", "PKX": "AS_E", "CAN": "AS_E", "SZX": "AS_E",
    "CTU": "AS_E", "XIY": "AS_E", "SHA": "AS_E", "HGH": "AS_E", "NKG": "AS_E",
    "TPE": "AS_E", "TSA": "AS_E", "KHH": "AS_E",
    "HKG": "AS_E", "MFM": "AS_E",
    "ULN": "AS_E",  # Mongolia
    
    # Asia Southeast
    "SIN": "AS_SE", "KUL": "AS_SE", "BKK": "AS_SE", "DMK": "AS_SE",
    "SGN": "AS_SE", "HAN": "AS_SE", "DAD": "AS_SE",
    "MNL": "AS_SE", "CEB": "AS_SE",
    "CGK": "AS_SE", "DPS": "AS_SE", "SUB": "AS_SE",
    "RGN": "AS_SE", "PNH": "AS_SE", "REP": "AS_SE", "VTE": "AS_SE",
    
    # Asia South
    "DEL": "AS_S", "BOM": "AS_S", "BLR": "AS_S", "MAA": "AS_S", "CCU": "AS_S",
    "HYD": "AS_S", "COK": "AS_S", "AMD": "AS_S", "PNQ": "AS_S", "GOI": "AS_S",
    "CMB": "AS_S", "MLE": "AS_S",  # Sri Lanka, Maldives
    "DAC": "AS_S", "KTM": "AS_S",  # Bangladesh, Nepal
    "KHI": "AS_S", "LHE": "AS_S", "ISB": "AS_S",  # Pakistan
    
    # Middle East
    "DXB": "ME", "AUH": "ME", "SHJ": "ME",  # UAE
    "DOH": "ME",  # Qatar
    "RUH": "ME", "JED": "ME", "DMM": "ME",  # Saudi
    "KWI": "ME", "BAH": "ME", "MCT": "ME",  # Kuwait, Bahrain, Oman
    "TLV": "ME", "AMM": "ME", "BEY": "ME",  # Israel, Jordan, Lebanon
    "IST": "ME", "SAW": "ME", "AYT": "ME", "ESB": "ME",  # Turkey
    "CAI": "ME", "HRG": "ME", "SSH": "ME",  # Egypt (culturally Middle East for travel)
    "THR": "ME", "IKA": "ME",  # Iran
    
    # Africa
    "JNB": "AF", "CPT": "AF", "DUR": "AF",  # South Africa
    "NBO": "AF", "MBA": "AF",  # Kenya
    "ADD": "AF",  # Ethiopia
    "LOS": "AF", "ABV": "AF",  # Nigeria
    "ACC": "AF", "ABJ": "AF", "DKR": "AF",  # West Africa
    "CMN": "AF", "RAK": "AF", "TNG": "AF",  # Morocco
    "TUN": "AF", "ALG": "AF",  # Tunisia, Algeria
    "MRU": "AF", "SEZ": "AF",  # Mauritius, Seychelles
    "DAR": "AF", "ZNZ": "AF",  # Tanzania
    "EBB": "AF", "KGL": "AF",  # Uganda, Rwanda
    
    # Oceania
    "SYD": "OC", "MEL": "OC", "BNE": "OC", "PER": "OC", "ADL": "OC", "CNS": "OC",
    "AKL": "OC", "WLG": "OC", "CHC": "OC", "ZQN": "OC",
    "NAN": "OC", "PPT": "OC", "APW": "OC",  # Fiji, Tahiti, Samoa
    "POM": "OC", "HIR": "OC",  # Papua New Guinea, Solomon Islands
    
    # South America
    "GRU": "SA", "GIG": "SA", "BSB": "SA", "CNF": "SA", "SSA": "SA", "REC": "SA",
    "EZE": "SA", "AEP": "SA", "COR": "SA", "MDZ": "SA",
    "SCL": "SA", "LIM": "SA", "BOG": "SA", "MDE": "SA", "CTG": "SA",
    "CCS": "SA", "UIO": "SA", "GYE": "SA",
    "MVD": "SA", "ASU": "SA", "LPB": "SA", "VVI": "SA",
    
    # Central America
    "PTY": "CA", "SJO": "CA", "LIR": "CA",  # Panama, Costa Rica
    "GUA": "CA", "SAL": "CA", "TGU": "CA", "MGA": "CA", "BZE": "CA",
    
    # Caribbean
    "SJU": "CB", "STT": "CB", "STX": "CB",  # Puerto Rico, USVI
    "NAS": "CB", "FPO": "CB",  # Bahamas
    "MBJ": "CB", "KIN": "CB",  # Jamaica
    "PUJ": "CB", "SDQ": "CB",  # Dominican Republic
    "HAV": "CB", "VRA": "CB",  # Cuba
    "BGI": "CB", "POS": "CB", "AUA": "CB", "CUR": "CB", "SXM": "CB",
    "GCM": "CB", "PAP": "CB",
}

# Country code to region mapping (for airports not in our database)
# Based on first letter patterns common in IATA codes
COUNTRY_CODE_HINTS = {
    # Y prefix - mostly Canada
    "Y": "NA",
    # K prefix - mostly US (domestic ICAO, but some IATA overlap)
    "K": "NA",
    # E prefix - Northern Europe
    "E": "EU",
    # L prefix - Southern Europe
    "L": "EU",
    # O prefix - often Middle East/Asia
    "O": "ME",
    # V prefix - often South/Southeast Asia
    "V": "AS_SE",
    # W prefix - often Indonesia
    "W": "AS_SE",
    # Z prefix - often China
    "Z": "AS_E",
    # R prefix - often East Asia (Japan, Korea)
    "R": "AS_E",
    # S prefix - often South America
    "S": "SA",
    # F prefix - often Africa
    "F": "AF",
    # H prefix - often Africa
    "H": "AF",
    # A prefix - often Oceania
    "A": "OC",
    # N prefix - often Pacific
    "N": "OC",
    # P prefix - often Pacific (including Hawaii airports like PHNL)
    "P": "OC",
    # T prefix - often Caribbean
    "T": "CB",
    # M prefix - often Central America/Caribbean
    "M": "CA",
}


def get_airport_region(airport_code: str) -> str:
    """
    Get the region for any airport code.
    Uses database lookup first, then intelligent fallback based on code patterns.
    """
    code = airport_code.upper().strip()
    
    # First check our comprehensive database
    if code in AIRPORT_PREFIX_REGIONS:
        return AIRPORT_PREFIX_REGIONS[code]
    
    # Fallback: Use first letter hints
    if code and code[0] in COUNTRY_CODE_HINTS:
        return COUNTRY_CODE_HINTS[code[0]]
    
    # Ultimate fallback: assume international (Europe as a neutral middle point)
    return "EU"


def _classify_route(origin: str, destination: str) -> str:
    """
    Classify route type for pricing based on origin and destination regions.
    Returns: "domestic", "short_haul", "transatlantic", "transpacific", "middleeast", "long_haul"
    """
    orig_region = get_airport_region(origin)
    dest_region = get_airport_region(destination)
    
    # Same region = domestic or short-haul
    if orig_region == dest_region:
        # Within North America
        if orig_region == "NA":
            return "domestic"
        # Within Europe
        if orig_region == "EU":
            return "short_haul"
        # Within same Asian sub-region
        if orig_region in ("AS_E", "AS_SE", "AS_S"):
            return "short_haul"
        # Within other regions
        return "short_haul"
    
    # Cross-regional routes
    regions = {orig_region, dest_region}
    
    # North America <-> Europe = Transatlantic
    if regions == {"NA", "EU"}:
        return "transatlantic"
    
    # North America <-> East/Southeast Asia = Transpacific
    if "NA" in regions and regions & {"AS_E", "AS_SE"}:
        return "transpacific"
    
    # North America <-> Middle East
    if "NA" in regions and "ME" in regions:
        return "middleeast"
    
    # North America <-> South Asia (India etc)
    if "NA" in regions and "AS_S" in regions:
        return "long_haul"
    
    # North America <-> Oceania
    if "NA" in regions and "OC" in regions:
        return "transpacific"
    
    # North America <-> South America
    if "NA" in regions and "SA" in regions:
        return "transatlantic"  # Similar distance/pricing to transatlantic
    
    # North America <-> Africa
    if "NA" in regions and "AF" in regions:
        return "long_haul"
    
    # Europe <-> East Asia
    if "EU" in regions and regions & {"AS_E", "AS_SE"}:
        return "long_haul"
    
    # Europe <-> Middle East (shorter than transpacific)
    if "EU" in regions and "ME" in regions:
        return "middleeast"
    
    # Europe <-> South Asia
    if "EU" in regions and "AS_S" in regions:
        return "middleeast"
    
    # Europe <-> Africa
    if "EU" in regions and "AF" in regions:
        return "transatlantic"  # Medium-haul
    
    # Europe <-> Oceania
    if "EU" in regions and "OC" in regions:
        return "long_haul"
    
    # Asia regions to Middle East
    if regions & {"AS_E", "AS_SE", "AS_S"} and "ME" in regions:
        return "middleeast"
    
    # Asia to Oceania
    if regions & {"AS_E", "AS_SE"} and "OC" in regions:
        return "transpacific"
    
    # Caribbean/Central America to North America (short-haul international)
    if "NA" in regions and regions & {"CB", "CA"}:
        return "short_haul"
    
    # Default for any other international route
    return "long_haul"


# =============================================================================
# AWARD PRICING BY ROUTE TYPE
# =============================================================================

AWARD_PRICING = {
    "domestic": {
        "Economy": {"min_points": 10000, "max_points": 35000, "surcharge_range": (5.60, 30.00)},
        "Premium Economy": {"min_points": 20000, "max_points": 50000, "surcharge_range": (5.60, 40.00)},
        "Business": {"min_points": 40000, "max_points": 70000, "surcharge_range": (5.60, 60.00)},
        "First": {"min_points": 60000, "max_points": 100000, "surcharge_range": (5.60, 80.00)},
    },
    "short_haul": {
        "Economy": {"min_points": 15000, "max_points": 45000, "surcharge_range": (20.00, 100.00)},
        "Premium Economy": {"min_points": 30000, "max_points": 65000, "surcharge_range": (30.00, 150.00)},
        "Business": {"min_points": 50000, "max_points": 90000, "surcharge_range": (50.00, 250.00)},
        "First": {"min_points": 80000, "max_points": 130000, "surcharge_range": (75.00, 350.00)},
    },
    "transatlantic": {
        "Economy": {"min_points": 30000, "max_points": 60000, "surcharge_range": (50.00, 300.00)},
        "Premium Economy": {"min_points": 50000, "max_points": 85000, "surcharge_range": (75.00, 400.00)},
        "Business": {"min_points": 70000, "max_points": 120000, "surcharge_range": (100.00, 600.00)},
        "First": {"min_points": 100000, "max_points": 180000, "surcharge_range": (150.00, 800.00)},
    },
    "transpacific": {
        "Economy": {"min_points": 35000, "max_points": 70000, "surcharge_range": (30.00, 150.00)},
        "Premium Economy": {"min_points": 60000, "max_points": 100000, "surcharge_range": (50.00, 200.00)},
        "Business": {"min_points": 80000, "max_points": 140000, "surcharge_range": (75.00, 350.00)},
        "First": {"min_points": 110000, "max_points": 200000, "surcharge_range": (100.00, 500.00)},
    },
    "middleeast": {
        "Economy": {"min_points": 40000, "max_points": 75000, "surcharge_range": (50.00, 200.00)},
        "Premium Economy": {"min_points": 65000, "max_points": 110000, "surcharge_range": (75.00, 300.00)},
        "Business": {"min_points": 90000, "max_points": 150000, "surcharge_range": (100.00, 450.00)},
        "First": {"min_points": 130000, "max_points": 220000, "surcharge_range": (150.00, 600.00)},
    },
    "long_haul": {
        "Economy": {"min_points": 45000, "max_points": 80000, "surcharge_range": (60.00, 250.00)},
        "Premium Economy": {"min_points": 70000, "max_points": 120000, "surcharge_range": (100.00, 350.00)},
        "Business": {"min_points": 100000, "max_points": 170000, "surcharge_range": (150.00, 550.00)},
        "First": {"min_points": 150000, "max_points": 250000, "surcharge_range": (200.00, 750.00)},
    },
}

# Flight duration estimates (in minutes) by route type
FLIGHT_DURATIONS = {
    "domestic": (60, 360),       # 1-6 hours
    "short_haul": (90, 300),     # 1.5-5 hours
    "transatlantic": (360, 540), # 6-9 hours
    "transpacific": (600, 900),  # 10-15 hours
    "middleeast": (540, 840),    # 9-14 hours
    "long_haul": (720, 1080),    # 12-18 hours
}


# AIRLINE_PROGRAMS is now imported from src.config.programs (AIRLINE_PROGRAMS_FULL)


def _get_relevant_programs(origin: str, destination: str, programs: List[str]) -> List[str]:
    """Filter programs to those that actually fly the route (based on regions)."""
    orig_region = get_airport_region(origin)
    dest_region = get_airport_region(destination)
    
    relevant = []
    for prog in programs:
        if prog not in AIRLINE_PROGRAMS:
            continue
        prog_regions = AIRLINE_PROGRAMS[prog].get("regions", [])
        # Include if program serves either region
        if orig_region in prog_regions or dest_region in prog_regions:
            relevant.append(prog)
    
    # Always return at least some programs for fallback
    if not relevant and programs:
        # Return first few requested programs as fallback
        return programs[:5]
    
    return relevant


def _generate_flight_number(program_code: str, origin: str, destination: str) -> str:
    """Generate a realistic flight number for the program."""
    # Use a hash of the route to get consistent but varied flight numbers
    route_hash = hash(f"{program_code}{origin}{destination}") % 900 + 100
    return f"{program_code}{route_hash}"


def _generate_flight_time(date_str: str, route_type: str) -> str:
    """Generate realistic flight departure time based on route type."""
    # Long-haul tends to depart evening, short-haul throughout day
    if route_type in ("transpacific", "long_haul"):
        hours = [10, 11, 12, 13, 14, 21, 22, 23]
    elif route_type in ("transatlantic", "middleeast"):
        hours = [8, 9, 10, 17, 18, 19, 20, 21, 22]
    else:
        hours = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]
    
    hour = random.choice(hours)
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
    origin = origin.upper().strip()
    destination = destination.upper().strip()
    
    logger.info(f"[DUMMY] Generating flight data: {origin}->{destination} on {date}")
    
    route_type = _classify_route(origin, destination)
    pricing = AWARD_PRICING.get(route_type, AWARD_PRICING["transatlantic"])
    duration_range = FLIGHT_DURATIONS.get(route_type, (360, 600))
    
    # Filter to relevant programs for this route
    relevant_programs = _get_relevant_programs(origin, destination, programs)
    
    data = []
    
    for program_code in relevant_programs:
        if program_code not in AIRLINE_PROGRAMS:
            continue
            
        program = AIRLINE_PROGRAMS[program_code]
        
        # Generate 1-2 flight options per program
        num_flights = random.randint(1, 2)
        
        for flight_idx in range(num_flights):
            flight_num = _generate_flight_number(program_code, origin, destination)
            if flight_idx > 0:
                # Vary flight number for additional flights
                flight_num = f"{program_code}{int(flight_num[len(program_code):]) + flight_idx * 100}"
            
            for cabin in cabins:
                cabin_pricing = pricing.get(cabin, pricing["Economy"])
                
                # Randomly skip some cabin classes for realism
                if cabin in ("First", "Premium Economy") and random.random() < 0.3:
                    continue
                
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
                dep_time = _generate_flight_time(date, route_type)
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
                                "origin": origin,
                                "destination": destination,
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
    data.sort(key=lambda x: (x["cabin"], x["award_points"]))
    
    logger.info(f"[DUMMY] Generated {len(data)} flight options for {origin}->{destination} (route_type={route_type})")
    
    return {
        "data": data,
        "error": None,
        "message": None,
        "_dummy": True,
        "_route_type": route_type,
    }


# =============================================================================
# HOTEL DUMMY DATA
# =============================================================================

# HOTEL_PROGRAMS is now imported from src.config.programs (HOTEL_PROGRAMS_FULL)

# City tier for hotel pricing (affects both cash and points)
def _get_city_tier(destination: str) -> int:
    """
    Get city tier (1-3) for hotel pricing.
    Tier 1: Major expensive cities
    Tier 2: Secondary cities
    Tier 3: Budget destinations
    """
    region = get_airport_region(destination)
    code = destination.upper().strip()
    
    # Tier 1: Most expensive cities
    tier1_airports = {
        "JFK", "LGA", "EWR",  # NYC
        "LHR", "LGW",         # London
        "CDG", "ORY",         # Paris
        "NRT", "HND",         # Tokyo
        "SIN",                # Singapore
        "HKG",                # Hong Kong
        "DXB",                # Dubai
        "SYD",                # Sydney
        "SFO",                # San Francisco
        "GVA", "ZRH",         # Swiss cities
    }
    
    # Tier 2: Moderately expensive
    tier2_airports = {
        "LAX", "ORD", "MIA", "BOS", "SEA", "DEN",  # Major US
        "FRA", "MUC", "AMS", "BCN", "MAD", "FCO", "MXP",  # Europe
        "ICN", "PVG", "BKK", "KUL",  # Asia
        "DOH", "AUH",  # Gulf
        "MEL", "AKL",  # Oceania
    }
    
    if code in tier1_airports:
        return 1
    if code in tier2_airports:
        return 2
    return 3


def _get_city_name(destination: str) -> str:
    """Get city name from airport code."""
    airport_to_city = {
        "LHR": "London", "LGW": "London", "STN": "London",
        "CDG": "Paris", "ORY": "Paris",
        "NRT": "Tokyo", "HND": "Tokyo",
        "JFK": "New York", "EWR": "New York", "LGA": "New York",
        "DXB": "Dubai", "AUH": "Abu Dhabi",
        "LAX": "Los Angeles", "SFO": "San Francisco",
        "ORD": "Chicago", "MIA": "Miami", "ATL": "Atlanta",
        "SIN": "Singapore", "HKG": "Hong Kong", "ICN": "Seoul",
        "BKK": "Bangkok", "SYD": "Sydney", "MEL": "Melbourne",
        "FRA": "Frankfurt", "MUC": "Munich", "AMS": "Amsterdam",
        "MAD": "Madrid", "BCN": "Barcelona", "FCO": "Rome",
        "DOH": "Doha", "IST": "Istanbul",
    }
    
    code = destination.upper().strip()
    return airport_to_city.get(code, destination.title())


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
    """
    logger.info(f"[DUMMY] Generating hotel data: {destination} ({check_in} to {check_out})")
    
    # Calculate nights
    try:
        ci = datetime.strptime(check_in, "%Y-%m-%d")
        co = datetime.strptime(check_out, "%Y-%m-%d")
        nights = max(1, (co - ci).days)
    except ValueError:
        nights = 1
    
    city_name = _get_city_name(destination)
    city_tier = _get_city_tier(destination)
    
    # Price multipliers by tier
    tier_multipliers = {1: 1.5, 2: 1.0, 3: 0.7}
    price_mult = tier_multipliers.get(city_tier, 1.0)
    
    data = []
    hotel_id = 1
    
    for program_code in programs:
        if program_code not in HOTEL_PROGRAMS:
            continue
            
        program = HOTEL_PROGRAMS[program_code]
        
        # Generate 2-4 hotels per program
        num_hotels = random.randint(2, 4)
        brands_used = random.sample(program["brands"], min(num_hotels, len(program["brands"])))
        
        for brand in brands_used:
            # Determine star rating based on brand
            if brand in ("Waldorf Astoria", "Park Hyatt", "St. Regis", "Ritz-Carlton", "Conrad"):
                stars = 5
                points_mult = 1.5
                cash_range = (400, 800)
            elif brand in ("Grand Hyatt", "Andaz", "W Hotels", "InterContinental", "Kimpton"):
                stars = 5
                points_mult = 1.2
                cash_range = (300, 600)
            elif brand in ("Hilton", "Marriott", "Hyatt Regency", "Westin", "Crowne Plaza", "Renaissance"):
                stars = 4
                points_mult = 1.0
                cash_range = (200, 400)
            else:
                stars = 3
                points_mult = 0.7
                cash_range = (100, 250)
            
            # Apply star filter if specified
            if hotel_class and str(stars) != str(hotel_class).strip():
                continue
            
            # Calculate pricing
            base_points = random.randint(*program["points_per_night_range"])
            points_per_night = int(base_points * points_mult * price_mult)
            points_per_night = round(points_per_night / 1000) * 1000  # Round to thousands
            
            cash_per_night = random.randint(*cash_range) * price_mult
            cash_per_night = round(cash_per_night / 10) * 10
            
            total_points = points_per_night * nights
            total_cash = cash_per_night * nights
            
            # Calculate surcharge
            surcharge = 0
            if program["has_surcharge"]:
                surcharge = round(total_cash * random.uniform(0.10, 0.18), 2)
            
            data.append({
                "hotel_id": f"H{hotel_id:04d}",
                "id": f"H{hotel_id:04d}",
                "name": f"{brand} {city_name}",
                "hotel_name": f"{brand} {city_name}",
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
                "star_rating": stars,
                "stars": stars,
                "hotel_class": str(stars),
                "address": f"{random.randint(1, 999)} Main Street, {city_name}",
                "location": city_name,
            })
            hotel_id += 1
    
    # Sort by points (cheapest first)
    data.sort(key=lambda x: x.get("points", 0))
    
    logger.info(f"[DUMMY] Generated {len(data)} hotel options for {destination}")
    
    return {
        "data": data,
        "hotels": data,
        "error": None,
        "message": None,
        "_dummy": True,
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
    """
    origin = origin.upper().strip()
    destination = destination.upper().strip()
    
    logger.info(f"[DUMMY] Generating calendar data: {origin}->{destination}")
    
    route_type = _classify_route(origin, destination)
    pricing = AWARD_PRICING.get(route_type, AWARD_PRICING["transatlantic"])
    
    if start_date:
        try:
            current = datetime.strptime(start_date, "%Y-%m-%d")
        except ValueError:
            current = datetime.now()
    else:
        current = datetime.now()
    
    end_date = current + timedelta(days=months_ahead * 30)
    
    data = []
    
    # Get relevant programs for this route
    all_programs = list(AIRLINE_PROGRAMS.keys())
    relevant_programs = _get_relevant_programs(origin, destination, all_programs)[:6]
    
    while current < end_date:
        date_str = current.strftime("%Y-%m-%d")
        
        for program in relevant_programs:
            if program not in AIRLINE_PROGRAMS:
                continue
            
            # ~60% chance of availability on any given day
            if random.random() < 0.4:
                continue
            
            program_info = AIRLINE_PROGRAMS[program]
            surcharge_mult = program_info["surcharge_multiplier"]
            
            # Generate points for each cabin
            def get_cabin_points(cabin_name):
                if random.random() < 0.2:  # 20% chance of no availability
                    return None
                cabin_pricing = pricing.get(cabin_name, pricing["Economy"])
                pts = random.randint(cabin_pricing["min_points"], cabin_pricing["max_points"])
                return round(pts / 500) * 500
            
            y_pts = get_cabin_points("Economy")
            w_pts = get_cabin_points("Premium Economy") if random.random() > 0.3 else None
            j_pts = get_cabin_points("Business") if random.random() > 0.2 else None
            f_pts = get_cabin_points("First") if random.random() > 0.5 else None
            
            points = {
                "y": y_pts,
                "w": w_pts,
                "j": j_pts,
                "f": f_pts,
                "tax": {
                    "y": round(random.uniform(*pricing["Economy"]["surcharge_range"]) * surcharge_mult, 2) if y_pts else None,
                    "w": round(random.uniform(*pricing["Premium Economy"]["surcharge_range"]) * surcharge_mult, 2) if w_pts else None,
                    "j": round(random.uniform(*pricing["Business"]["surcharge_range"]) * surcharge_mult, 2) if j_pts else None,
                    "f": round(random.uniform(*pricing["First"]["surcharge_range"]) * surcharge_mult, 2) if f_pts else None,
                },
                "c_a": {
                    "y": [program] if y_pts else [],
                    "w": [program] if w_pts else [],
                    "j": [program] if j_pts else [],
                    "f": [program] if f_pts else [],
                },
                "c_s": {
                    "y": random.randint(1, 9) if y_pts else None,
                    "w": random.randint(1, 4) if w_pts else None,
                    "j": random.randint(1, 4) if j_pts else None,
                    "f": random.randint(1, 2) if f_pts else None,
                },
                "ss": {
                    "y": "Y" if y_pts else None,
                    "w": "Y" if w_pts else None,
                    "j": "Y" if j_pts else None,
                    "f": "Y" if f_pts else None,
                },
                "ls": current.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            
            # Non-stop points (slightly different if available)
            points_ns = {
                "y": int(y_pts * random.uniform(0.95, 1.1)) if y_pts and random.random() > 0.3 else None,
                "w": int(w_pts * random.uniform(0.95, 1.1)) if w_pts and random.random() > 0.4 else None,
                "j": int(j_pts * random.uniform(0.95, 1.1)) if j_pts and random.random() > 0.3 else None,
                "f": int(f_pts * random.uniform(0.95, 1.1)) if f_pts and random.random() > 0.5 else None,
                "ls": current.strftime("%Y-%m-%dT%H:%M:%S"),
            }
            
            data.append({
                "date": date_str,
                "program": program,
                "route": f"{origin}-{destination}",
                "points": points,
                "points_ns": points_ns,
                "r_ls": current.strftime("%Y-%m-%dT%H:%M:%S"),
            })
        
        current += timedelta(days=1)
    
    logger.info(f"[DUMMY] Generated {len(data)} calendar entries for {origin}->{destination}")
    
    return data


# =============================================================================
# SERP (GOOGLE FLIGHTS) DUMMY DATA
# =============================================================================

# Cash price ranges by route type (USD)
CASH_PRICES = {
    "domestic": {"Economy": (150, 450), "Premium Economy": (350, 700), "Business": (600, 1500), "First": (1200, 3000)},
    "short_haul": {"Economy": (200, 600), "Premium Economy": (450, 900), "Business": (800, 2000), "First": (1500, 4000)},
    "transatlantic": {"Economy": (400, 1200), "Premium Economy": (800, 2000), "Business": (2500, 6000), "First": (5000, 12000)},
    "transpacific": {"Economy": (500, 1500), "Premium Economy": (1000, 2500), "Business": (3000, 8000), "First": (6000, 15000)},
    "middleeast": {"Economy": (600, 1800), "Premium Economy": (1200, 3000), "Business": (3500, 9000), "First": (7000, 18000)},
    "long_haul": {"Economy": (700, 2000), "Premium Economy": (1500, 3500), "Business": (4000, 10000), "First": (8000, 20000)},
}


def generate_dummy_serp_data(
    origin: str,
    destination: str,
    date: str,
    travel_class: Optional[int] = None,
) -> Dict[str, Any]:
    """
    Generate dummy SerpAPI (Google Flights) response with cash prices.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        date: Date string (YYYY-MM-DD)
        travel_class: 1=Economy, 2=Premium Economy, 3=Business, 4=First
        
    Returns:
        Dict matching SerpAPI Google Flights response format
    """
    origin = origin.upper().strip()
    destination = destination.upper().strip()
    
    logger.info(f"[DUMMY SERP] Generating cash flight data: {origin}->{destination} on {date}")
    
    route_type = _classify_route(origin, destination)
    cash_pricing = CASH_PRICES.get(route_type, CASH_PRICES["transatlantic"])
    duration_range = FLIGHT_DURATIONS.get(route_type, (360, 600))
    
    # Map travel_class to cabin name
    cabin_map = {1: "Economy", 2: "Premium Economy", 3: "Business", 4: "First"}
    cabin = cabin_map.get(travel_class, "Economy")
    
    # Get relevant programs for this route
    all_programs = list(AIRLINE_PROGRAMS.keys())
    relevant_programs = _get_relevant_programs(origin, destination, all_programs)
    
    best_flights = []
    other_flights = []
    
    for program_code in relevant_programs[:6]:  # Limit to 6 airlines
        if program_code not in AIRLINE_PROGRAMS:
            continue
            
        program = AIRLINE_PROGRAMS[program_code]
        
        # Generate 1-3 flight options per airline
        num_flights = random.randint(1, 3)
        
        for flight_idx in range(num_flights):
            flight_num = _generate_flight_number(program_code, origin, destination)
            if flight_idx > 0:
                flight_num = f"{program_code}{int(flight_num[len(program_code):]) + flight_idx * 50}"
            
            # Calculate cash price
            price_range = cash_pricing.get(cabin, cash_pricing["Economy"])
            price = random.randint(*price_range)
            
            # Generate times
            duration = random.randint(*duration_range)
            dep_time = _generate_flight_time(date, route_type)
            arr_time = _generate_arrival_time(dep_time, duration)
            
            # Extract just time portion for SERP format
            dep_time_only = dep_time.split("T")[1][:5] if "T" in dep_time else "10:00"
            arr_time_only = arr_time.split("T")[1][:5] if "T" in arr_time else "18:00"
            
            flight_option = {
                "price": price,
                "type": "One way",
                "airline_logo": f"https://www.gstatic.com/flights/airline_logos/70px/{program_code}.png",
                "flights": [
                    {
                        "departure_airport": {
                            "name": f"{origin} International Airport",
                            "id": origin,
                            "time": dep_time_only,
                        },
                        "arrival_airport": {
                            "name": f"{destination} International Airport",
                            "id": destination,
                            "time": arr_time_only,
                        },
                        "duration": duration,
                        "airplane": "Boeing 777" if route_type in ("transpacific", "long_haul") else "Airbus A320",
                        "airline": program["name"].split()[0],
                        "airline_logo": f"https://www.gstatic.com/flights/airline_logos/70px/{program_code}.png",
                        "travel_class": cabin,
                        "flight_number": flight_num,
                        "legroom": "32 in" if cabin == "Economy" else "38 in",
                        "extensions": ["Wi-Fi", "Power outlet"],
                    }
                ],
                "total_duration": duration,
                "carbon_emissions": {
                    "this_flight": random.randint(200, 800) * 1000,
                    "typical_for_this_route": random.randint(250, 900) * 1000,
                },
            }
            
            # First few go to best_flights, rest to other_flights
            if len(best_flights) < 5:
                best_flights.append(flight_option)
            else:
                other_flights.append(flight_option)
    
    # Sort best flights by price
    best_flights.sort(key=lambda x: x["price"])
    other_flights.sort(key=lambda x: x["price"])
    
    logger.info(f"[DUMMY SERP] Generated {len(best_flights)} best + {len(other_flights)} other flights for {origin}->{destination}")
    
    return {
        "search_metadata": {
            "id": f"dummy_{origin}_{destination}_{date}",
            "status": "Success",
            "json_endpoint": "dummy",
            "created_at": datetime.now().isoformat(),
            "processed_at": datetime.now().isoformat(),
            "google_flights_url": f"https://www.google.com/travel/flights?q={origin}+to+{destination}",
            "raw_html_file": "dummy",
            "prettify_html_file": "dummy",
            "total_time_taken": 0.5,
        },
        "search_parameters": {
            "engine": "google_flights",
            "type": "2",
            "departure_id": origin,
            "arrival_id": destination,
            "outbound_date": date,
            "currency": "USD",
            "hl": "en",
        },
        "best_flights": best_flights,
        "other_flights": other_flights,
        "price_insights": {
            "lowest_price": min(f["price"] for f in best_flights) if best_flights else 0,
            "price_level": "typical",
        },
        "_dummy": True,
    }


# =============================================================================
# CONVENIENCE FUNCTIONS
# =============================================================================

def get_dummy_flights(origin: str, destination: str, date: str, cabins: List[str] = None, programs: List[str] = None) -> Dict[str, Any]:
    """Convenience wrapper for flight dummy data."""
    cabins = cabins or ["Economy", "Business"]
    programs = programs or list(AIRLINE_PROGRAMS.keys())
    return generate_dummy_flight_data(origin, destination, date, cabins, programs)


def get_dummy_serp(origin: str, destination: str, date: str, travel_class: int = 1) -> Dict[str, Any]:
    """Convenience wrapper for SERP dummy data."""
    return generate_dummy_serp_data(origin, destination, date, travel_class)


def get_dummy_hotels(destination: str, check_in: str, check_out: str, programs: List[str] = None) -> Dict[str, Any]:
    """Convenience wrapper for hotel dummy data."""
    programs = programs or ["HH", "MAR", "HYATT", "IHG"]
    return generate_dummy_hotel_data(destination, check_in, check_out, programs)


def get_dummy_calendar(origin: str, destination: str) -> List[Dict[str, Any]]:
    """Convenience wrapper for calendar dummy data."""
    return generate_dummy_calendar_data(origin, destination)
