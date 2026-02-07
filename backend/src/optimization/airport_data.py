"""
Airport data module for connection protection derivation.

Provides data-driven lookups for:
- Country by airport code
- US preclearance airports
- Airport validation

Data is loaded from JSON file with set normalization for O(1) lookups.
"""

import json
import logging
from functools import lru_cache
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).parent / "data"


@lru_cache(maxsize=1)
def _load_airport_data() -> dict:
    """
    Load airport data from JSON file.
    
    IMPORTANT: Normalizes membership-heavy lists to sets for O(1) lookup.
    Original lists are preserved for serialization (json.dumps would fail on sets).
    """
    path = DATA_DIR / "airports.json"
    if not path.exists():
        # Fallback to minimal embedded data
        logger.warning("airports.json not found, using fallback data")
        data = _get_fallback_airport_data()
    else:
        with open(path) as f:
            data = json.load(f)
    
    # ═══════════════════════════════════════════════════════════════════════
    # NORMALIZE: Create O(1) sets for membership checks
    # 
    # Keep original lists for serialization (json.dumps would fail on sets),
    # but create private _set versions for fast lookup.
    # ═══════════════════════════════════════════════════════════════════════
    
    if "us_preclearance_airports" in data:
        data["_us_preclearance_set"] = set(data["us_preclearance_airports"])
    else:
        data["_us_preclearance_set"] = set()
    
    # Build airport code set for validation
    if "airports" in data:
        data["_airport_codes_set"] = set(data["airports"].keys())
    else:
        data["_airport_codes_set"] = set()
    
    # Future: normalize other membership-heavy lists here
    # e.g., data["_schengen_set"] = set(data.get("schengen_airports", []))
    
    return data


def _get_fallback_airport_data() -> dict:
    """
    Minimal fallback data when airports.json is missing.
    
    NOTE: Uses lists (not sets) for JSON serialization compatibility.
    Sets are created in _load_airport_data().
    """
    return {
        # US preclearance airports (CBP source)
        # https://www.cbp.gov/travel/preclearance
        "us_preclearance_airports": [
            # Canada
            "YYZ", "YVR", "YUL", "YOW", "YWG", "YHZ", "YEG", "YYC",
            # Caribbean
            "NAS", "FPO", "AUA", "BDA",
            # Ireland
            "DUB", "SNN",
            # UAE
            "AUH",
        ],
        
        # Major US airports (for port of entry detection)
        "us_airports": [
            "JFK", "LAX", "ORD", "DFW", "DEN", "SFO", "SEA", "ATL", "BOS", "MIA",
            "EWR", "IAH", "HOU", "PHX", "MSP", "DTW", "LGA", "FLL", "BWI", "SLC",
            "DCA", "IAD", "SAN", "TPA", "PDX", "STL", "HNL", "AUS", "MCO", "CLT",
            "PHL", "MDW", "DAL", "BUR", "OAK", "SJC", "SNA", "ONT", "LAS", "BNA",
            "RDU", "SAT",
        ],
        
        # Airport to country mapping (IATA -> ISO country code)
        "airports": {
            # US
            "JFK": {"country": "US", "name": "John F Kennedy Intl"},
            "LAX": {"country": "US", "name": "Los Angeles Intl"},
            "ORD": {"country": "US", "name": "Chicago O'Hare"},
            "DFW": {"country": "US", "name": "Dallas Fort Worth"},
            "DEN": {"country": "US", "name": "Denver Intl"},
            "SFO": {"country": "US", "name": "San Francisco Intl"},
            "SEA": {"country": "US", "name": "Seattle-Tacoma"},
            "ATL": {"country": "US", "name": "Hartsfield-Jackson Atlanta"},
            "BOS": {"country": "US", "name": "Boston Logan"},
            "MIA": {"country": "US", "name": "Miami Intl"},
            "EWR": {"country": "US", "name": "Newark Liberty"},
            "IAH": {"country": "US", "name": "George Bush Intercontinental"},
            "HOU": {"country": "US", "name": "William P. Hobby"},
            "LGA": {"country": "US", "name": "LaGuardia"},
            "IAD": {"country": "US", "name": "Washington Dulles"},
            "DCA": {"country": "US", "name": "Ronald Reagan Washington"},
            # UK
            "LHR": {"country": "GB", "name": "London Heathrow"},
            "LGW": {"country": "GB", "name": "London Gatwick"},
            "STN": {"country": "GB", "name": "London Stansted"},
            "MAN": {"country": "GB", "name": "Manchester"},
            # Europe
            "CDG": {"country": "FR", "name": "Paris Charles de Gaulle"},
            "ORY": {"country": "FR", "name": "Paris Orly"},
            "FRA": {"country": "DE", "name": "Frankfurt"},
            "MUC": {"country": "DE", "name": "Munich"},
            "AMS": {"country": "NL", "name": "Amsterdam Schiphol"},
            "MAD": {"country": "ES", "name": "Madrid Barajas"},
            "BCN": {"country": "ES", "name": "Barcelona El Prat"},
            "FCO": {"country": "IT", "name": "Rome Fiumicino"},
            "ZRH": {"country": "CH", "name": "Zurich"},
            # Canada
            "YYZ": {"country": "CA", "name": "Toronto Pearson"},
            "YVR": {"country": "CA", "name": "Vancouver"},
            "YUL": {"country": "CA", "name": "Montreal Trudeau"},
            "YYC": {"country": "CA", "name": "Calgary"},
            "YOW": {"country": "CA", "name": "Ottawa"},
            # Ireland
            "DUB": {"country": "IE", "name": "Dublin"},
            "SNN": {"country": "IE", "name": "Shannon"},
            # Caribbean
            "NAS": {"country": "BS", "name": "Nassau"},
            "AUA": {"country": "AW", "name": "Aruba"},
            "BDA": {"country": "BM", "name": "Bermuda"},
            # UAE
            "AUH": {"country": "AE", "name": "Abu Dhabi"},
            "DXB": {"country": "AE", "name": "Dubai"},
            # Asia
            "NRT": {"country": "JP", "name": "Tokyo Narita"},
            "HND": {"country": "JP", "name": "Tokyo Haneda"},
            "ICN": {"country": "KR", "name": "Seoul Incheon"},
            "SIN": {"country": "SG", "name": "Singapore Changi"},
            "HKG": {"country": "HK", "name": "Hong Kong"},
            "PEK": {"country": "CN", "name": "Beijing Capital"},
            "PVG": {"country": "CN", "name": "Shanghai Pudong"},
            # Mexico
            "MEX": {"country": "MX", "name": "Mexico City"},
            "CUN": {"country": "MX", "name": "Cancun"},
        },
    }


def get_airport_country(iata_code: str) -> Optional[str]:
    """
    Get the country code for an airport.
    
    Returns ISO 2-letter country code or None if unknown.
    """
    if not iata_code:
        return None
    
    data = _load_airport_data()
    airports = data.get("airports", {})
    airport_info = airports.get(iata_code.upper())
    
    if airport_info:
        return airport_info.get("country")
    
    return None


def is_us_airport(iata_code: str) -> bool:
    """Check if airport is in the United States."""
    return get_airport_country(iata_code) == "US"


def has_us_preclearance(iata_code: str) -> bool:
    """
    Check if airport has US Customs preclearance.
    
    At preclearance airports, passengers clear US customs BEFORE departure.
    They arrive as "domestic" passengers and don't need to re-clear.
    
    Source: https://www.cbp.gov/travel/preclearance
    """
    if not iata_code:
        return False
    
    data = _load_airport_data()
    # Use private set for O(1) lookup (original list kept for serialization)
    preclearance = data.get("_us_preclearance_set", set())
    return iata_code.upper() in preclearance


def is_valid_iata(iata_code: str) -> bool:
    """
    Check if an IATA code is in our airport dataset.
    
    Used to distinguish real airport changes from parse corruption.
    Returns False for empty/None or codes not in our dataset.
    """
    if not iata_code:
        return False
    
    data = _load_airport_data()
    # Use private set for O(1) lookup
    airport_codes = data.get("_airport_codes_set", set())
    return iata_code.upper() in airport_codes


def is_same_airport_code(iata1: str, iata2: str) -> bool:
    """
    Check if two airport codes are the exact same airport.
    
    NOTE: This is intentionally named precisely. It does NOT check:
    - Metro area (JFK, LGA, EWR are all NYC but different airports)
    - Terminal groupings
    - City pairs
    
    For transfer feasibility, we need exact airport match.
    Different IATA codes = different airports = likely landside transfer.
    
    DO NOT "upgrade" this to treat JFK/LGA/EWR as "same system" -
    you cannot stay airside between them!
    
    For search expansion (showing flights to any NYC airport), use a 
    separate `same_city_cluster()` function (not implemented here).
    """
    if not iata1 or not iata2:
        return False
    return iata1.upper() == iata2.upper()


def clear_cache():
    """Clear the airport data cache (for testing)."""
    _load_airport_data.cache_clear()
