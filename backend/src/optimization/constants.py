"""
Constants and configuration for the optimization system.

This module centralizes all magic numbers, thresholds, and default values.
"""

from typing import Dict, Set


# =============================================================================
# TRANSFER GRAPH: Bank -> Airline mappings with transfer ratios
# =============================================================================

DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = {
    "chase": {
        # Chase Ultimate Rewards partners
        "UA": 1.0,   # United MileagePlus
        "BA": 1.0,   # British Airways Avios
        "AF": 1.0,   # Air France/KLM Flying Blue
        "SQ": 1.0,   # Singapore KrisFlyer
        "VS": 1.0,   # Virgin Atlantic
        "IB": 1.0,   # Iberia Plus
        "EK": 1.0,   # Emirates Skywards
        "AC": 1.0,   # Air Canada Aeroplan
        "AV": 1.0,   # Avianca LifeMiles
        "HYATT": 1.0,  # World of Hyatt
        "MAR": 1.0,  # Marriott Bonvoy (3:1 but set to 1 here, adjusted elsewhere)
    },
    "amex": {
        # Amex Membership Rewards partners
        "DL": 1.0,   # Delta SkyMiles
        "BA": 1.0,   # British Airways Avios
        "AF": 1.0,   # Air France/KLM Flying Blue
        "SQ": 1.0,   # Singapore KrisFlyer
        "NH": 1.0,   # ANA Mileage Club
        "VS": 1.0,   # Virgin Atlantic
        "EK": 1.0,   # Emirates Skywards
        "AV": 1.0,   # Avianca LifeMiles
        "EY": 1.0,   # Etihad Guest
        "QR": 1.0,   # Qatar Airways Privilege Club
        "AC": 1.0,   # Air Canada Aeroplan
        "JL": 1.0,   # Japan Airlines Mileage Bank
        "HH": 1.0,   # Hilton Honors (often 1:2 but varies)
        "MAR": 1.0,  # Marriott Bonvoy
    },
    "citi": {
        # Citi ThankYou partners
        "AA": 1.0,   # American AAdvantage
        "TK": 1.0,   # Turkish Miles&Smiles
        "QF": 1.0,   # Qantas Frequent Flyer
        "SQ": 1.0,   # Singapore KrisFlyer
        "VS": 1.0,   # Virgin Atlantic
        "EY": 1.0,   # Etihad Guest
        "AF": 1.0,   # Air France/KLM Flying Blue
        "JL": 1.0,   # Japan Airlines Mileage Bank
        "CX": 1.0,   # Cathay Pacific Asia Miles
        "AC": 1.0,   # Air Canada Aeroplan
        "QR": 1.0,   # Qatar Airways Privilege Club
        "EK": 1.0,   # Emirates Skywards
    },
    "capitalone": {
        # Capital One Miles partners
        "AF": 1.0,   # Air France/KLM Flying Blue
        "BA": 0.75,  # British Airways (1000:750 ratio)
        "TK": 1.0,   # Turkish Miles&Smiles
        "EK": 1.0,   # Emirates Skywards
        "SQ": 1.0,   # Singapore KrisFlyer
        "QF": 1.0,   # Qantas Frequent Flyer
        "AV": 1.0,   # Avianca LifeMiles
        "AC": 1.0,   # Air Canada Aeroplan
        "FJ": 1.0,   # Fiji Airways
        "TP": 1.0,   # TAP Air Portugal
    },
    "bilt": {
        # Bilt Rewards partners
        "UA": 1.0,   # United MileagePlus
        "AA": 1.0,   # American AAdvantage
        "BA": 1.0,   # British Airways Avios
        "AF": 1.0,   # Air France/KLM Flying Blue
        "TK": 1.0,   # Turkish Miles&Smiles
        "VS": 1.0,   # Virgin Atlantic
        "AC": 1.0,   # Air Canada Aeroplan
        "EK": 1.0,   # Emirates Skywards
        "CX": 1.0,   # Cathay Pacific Asia Miles
        "HYATT": 1.0,  # World of Hyatt
        "IHG": 1.0,  # IHG One Rewards
        "MAR": 1.0,  # Marriott Bonvoy
    },
}


# =============================================================================
# PROGRAM-SPECIFIC CPP THRESHOLDS (Cents Per Point minimum)
# =============================================================================

CPP_THRESHOLDS: Dict[str, float] = {
    # Premium programs - higher threshold (save for better redemptions)
    "SQ": 1.5,   # Singapore - premium redemptions
    "NH": 1.5,   # ANA - sweet spots exist but valuable
    "CX": 1.5,   # Cathay - good J/F redemptions
    "BA": 1.8,   # British Airways - high surcharges, need higher CPP
    "VS": 1.4,   # Virgin Atlantic - good for partner redemptions
    
    # Mid-tier programs
    "AF": 1.2,   # Air France/KLM - decent value
    "TK": 1.3,   # Turkish - good partner redemptions
    "QF": 1.3,   # Qantas - high surcharges on own metal
    "EK": 1.2,   # Emirates - reasonable value
    
    # Domestic/flexible programs - lower threshold
    "UA": 1.0,   # United - flexible, variable value
    "AA": 1.0,   # American - flexible pricing
    "DL": 0.9,   # Delta - variable value
    "B6": 0.9,   # JetBlue - direct use at ~1cpp
    "AS": 1.0,   # Alaska - good value
    
    # LCCs - lower threshold
    "WN": 0.8,   # Southwest - direct redemption
    "F9": 0.8,   # Frontier
    "NK": 0.8,   # Spirit
}

DEFAULT_CPP_THRESHOLD = 1.2  # For unknown programs


# =============================================================================
# HIGH SURCHARGE PROGRAMS (Known for fuel surcharges on awards)
# =============================================================================

HIGH_SURCHARGE_PROGRAMS: Set[str] = {
    "BA",  # British Airways - notorious for surcharges
    "LH",  # Lufthansa
    "LX",  # Swiss
    "OS",  # Austrian
    "QF",  # Qantas
    "VS",  # Virgin Atlantic
    "SQ",  # Singapore (on some routes)
    "NH",  # ANA (some partner routes)
}


# =============================================================================
# HUB CITIES: Recognized airline hubs (legitimate connection points)
# =============================================================================

HUB_CITIES: Set[str] = {
    # Middle East hubs
    'IST',  # Istanbul - Turkish Airlines
    'DOH',  # Doha - Qatar Airways
    'DXB',  # Dubai - Emirates
    'AUH',  # Abu Dhabi - Etihad
    'BAH',  # Bahrain - Gulf Air
    'AMM',  # Amman - Royal Jordanian
    'JED',  # Jeddah - Saudia
    'RUH',  # Riyadh - Saudia
    
    # European hubs
    'CDG',  # Paris - Air France
    'LHR',  # London Heathrow - British Airways
    'FRA',  # Frankfurt - Lufthansa
    'AMS',  # Amsterdam - KLM
    'ZRH',  # Zurich - Swiss
    'MUC',  # Munich - Lufthansa
    'VIE',  # Vienna - Austrian
    'MAD',  # Madrid - Iberia
    'FCO',  # Rome - ITA Airways
    'LIS',  # Lisbon - TAP
    'WAW',  # Warsaw - LOT
    'HEL',  # Helsinki - Finnair
    'CPH',  # Copenhagen - SAS
    'ARN',  # Stockholm - SAS
    
    # US hubs
    'JFK',  # New York JFK
    'EWR',  # Newark
    'LAX',  # Los Angeles
    'ORD',  # Chicago O'Hare
    'DFW',  # Dallas
    'MIA',  # Miami
    'ATL',  # Atlanta - Delta
    'IAH',  # Houston
    'SFO',  # San Francisco
    'SEA',  # Seattle
    'BOS',  # Boston
    'IAD',  # Washington Dulles
    'CLT',  # Charlotte
    'PHL',  # Philadelphia
    'DEN',  # Denver
    'PHX',  # Phoenix
    
    # Canadian hubs
    'YYZ',  # Toronto
    'YVR',  # Vancouver
    'YUL',  # Montreal
    
    # Asian hubs
    'SIN',  # Singapore
    'HKG',  # Hong Kong
    'ICN',  # Seoul Incheon
    'NRT',  # Tokyo Narita
    'HND',  # Tokyo Haneda
    'PEK',  # Beijing
    'PVG',  # Shanghai
    'BKK',  # Bangkok
    'KUL',  # Kuala Lumpur
    'DEL',  # Delhi
    'BOM',  # Mumbai
    'TPE',  # Taipei
    'MNL',  # Manila
    
    # African hubs
    'JNB',  # Johannesburg
    'ADD',  # Addis Ababa - Ethiopian
    'NBO',  # Nairobi
    'CAI',  # Cairo
    'CMN',  # Casablanca
    
    # South American hubs
    'GRU',  # Sao Paulo
    'EZE',  # Buenos Aires
    'BOG',  # Bogota
    'SCL',  # Santiago
    'LIM',  # Lima
    'PTY',  # Panama City
    
    # Oceania hubs
    'SYD',  # Sydney
    'MEL',  # Melbourne
    'AKL',  # Auckland
}


# =============================================================================
# OOP MODE CONFIGURATION
# =============================================================================

class OOP_CONFIG:
    """Configuration for Out-Of-Pocket optimization mode."""
    
    # Minimum CPP to use points (lower than CPP mode - willing to use points at lower value)
    MIN_CPP_THRESHOLD = 0.5
    
    # Maximum surcharge as percentage of cash price (reject awards above this)
    MAX_SURCHARGE_RATIO = 0.50  # 50%
    
    # Maximum absolute surcharge per segment
    MAX_SURCHARGE_ABSOLUTE = 300.0  # $300
    
    # Surcharge penalty weight (for objective function)
    SURCHARGE_PENALTY_WEIGHT = 50.0
    
    # Surcharge threshold before penalty kicks in
    SURCHARGE_PENALTY_THRESHOLD = 50.0  # No penalty under $50
    
    # Extra penalty multiplier for high-surcharge programs
    HIGH_SURCHARGE_PROGRAM_MULTIPLIER = 1.5
    
    # Objective weights (BALANCED RANKING)
    # These weights create a balance between cost, time, and connections
    W_SAVINGS = 1e6      # Reward for using points to save cash
    W_CASH = 1e5         # Penalize cash spending
    W_SURCHARGE = 1e3    # Penalize high surcharges
    W_TIME = 1e2         # Penalize travel time (more significant)
    W_EXTRA_CITY = 1e7   # Penalize non-hub transit cities
    W_CONNECTION = 1e6   # Penalize extra connections beyond minimum
    W_CARD_BENEFIT = 1e4 # Bonus for card perks (free bags etc)


# =============================================================================
# CPP MODE CONFIGURATION
# =============================================================================

class CPP_CONFIG:
    """Configuration for Cents-Per-Point optimization mode."""
    
    # Default minimum CPP to use points
    DEFAULT_MIN_CPP = 1.2
    
    # Surcharge rejection thresholds (same as OOP)
    MAX_SURCHARGE_RATIO = 0.50
    MAX_SURCHARGE_ABSOLUTE = 300.0
    
    # Objective weights (BALANCED RANKING)
    W_POINTS_VALUE = 1e6   # Primary: maximize CPP
    W_CASH = 1e3           # Secondary: minimize cash
    W_TIME = 1e2           # Penalize travel time
    W_EXTRA_CITY = 1e7     # Penalize non-hub transit cities
    W_CONNECTION = 1e6     # Penalize extra connections
    W_CARD_BENEFIT = 1e4   # Bonus for card perks


# =============================================================================
# TRANSFER SETTINGS
# =============================================================================

class TRANSFER_CONFIG:
    """Configuration for point transfers."""
    
    # Minimum transfer block size (most programs require min 1000)
    DEFAULT_BLOCK_SIZE = 1000
    
    # Transfer time estimates
    INSTANT_TRANSFERS = {"chase", "citi", "bilt"}  # Usually instant
    SLOW_TRANSFERS = {"amex"}  # Can take 1-2 days


# =============================================================================
# SOLVER SETTINGS
# =============================================================================

class SOLVER_CONFIG:
    """Configuration for the ILP solver."""
    
    # PuLP solver timeout (seconds)
    TIMEOUT = 60
    
    # Max iterations for retry with relaxed budget
    MAX_BUDGET_RETRIES = 5
    BUDGET_MULTIPLIERS = [1.0, 2.0, 3.0, 5.0, 10.0]
    
    # Default values for missing data
    DEFAULT_CASH_IF_MISSING = 1e7  # Very high - effectively unavailable
    DEFAULT_TIME_IF_MISSING = 1e6  # Very high - effectively unavailable
    DEFAULT_CASH_BUDGET = 1e9      # Effectively unlimited
    
    # Big-M constant for constraints
    BIG_M = 1e6


# =============================================================================
# BANK NAME MAPPINGS
# =============================================================================

BANK_NAME_MAPPINGS: Dict[str, str] = {
    # Long names to short codes
    "amex_membership_rewards": "amex",
    "chase_ultimate_rewards": "chase",
    "citi_thankyou_points": "citi",
    "citi_thank_you": "citi",
    "capital_one_miles": "capitalone",
    "capitalone_miles": "capitalone",
    "bilt_rewards": "bilt",
    
    # Common variations
    "membership_rewards": "amex",
    "ultimate_rewards": "chase",
    "thankyou_points": "citi",
}

BANK_PREFIXES = ["amex", "chase", "citi", "capitalone", "bilt"]


# =============================================================================
# CREDIT CARD SUGGESTIONS (For transfer strategy display)
# =============================================================================

CREDIT_CARD_SUGGESTIONS: Dict[str, str] = {
    "chase": "Chase Sapphire Preferred/Reserve or Chase Ink Preferred",
    "amex": "Amex Platinum, Amex Gold, or Amex Business Platinum",
    "citi": "Citi Premier or Citi Custom Cash",
    "capitalone": "Capital One Venture X or Venture",
    "bilt": "Bilt Mastercard",
}


# =============================================================================
# AIRLINE DISPLAY NAMES
# =============================================================================

AIRLINE_NAMES: Dict[str, str] = {
    "UA": "United MileagePlus",
    "AA": "American AAdvantage",
    "DL": "Delta SkyMiles",
    "BA": "British Airways Avios",
    "AF": "Air France/KLM Flying Blue",
    "SQ": "Singapore KrisFlyer",
    "NH": "ANA Mileage Club",
    "TK": "Turkish Miles&Smiles",
    "VS": "Virgin Atlantic Flying Club",
    "EK": "Emirates Skywards",
    "QF": "Qantas Frequent Flyer",
    "CX": "Cathay Pacific Asia Miles",
    "AC": "Air Canada Aeroplan",
    "AS": "Alaska Mileage Plan",
    "AV": "Avianca LifeMiles",
    "EY": "Etihad Guest",
    "IB": "Iberia Plus",
    "JL": "Japan Airlines Mileage Bank",
    "HYATT": "World of Hyatt",
    "MAR": "Marriott Bonvoy",
    "HH": "Hilton Honors",
    "IHG": "IHG One Rewards",
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_cpp_threshold(airline: str) -> float:
    """Get CPP threshold for a specific airline program."""
    return CPP_THRESHOLDS.get(airline.upper(), DEFAULT_CPP_THRESHOLD)


def is_high_surcharge_program(airline: str) -> bool:
    """Check if airline is known for high surcharges."""
    return airline.upper() in HIGH_SURCHARGE_PROGRAMS


def get_airline_name(code: str) -> str:
    """Get display name for airline code."""
    return AIRLINE_NAMES.get(code.upper(), code)


def get_credit_card_suggestion(bank: str) -> str:
    """Get credit card suggestion for a bank program."""
    return CREDIT_CARD_SUGGESTIONS.get(bank.lower(), bank)


def normalize_bank_key(key: str) -> str:
    """
    Normalize a bank key to match the transfer graph format.
    
    e.g., 'amex_membership_rewards' -> 'amex'
          'Chase Ultimate Rewards' -> 'chase'
    """
    k_lower = key.lower().replace(" ", "_")
    
    # Direct mapping
    if k_lower in BANK_NAME_MAPPINGS:
        return BANK_NAME_MAPPINGS[k_lower]
    
    # Check prefixes
    for prefix in BANK_PREFIXES:
        if k_lower.startswith(prefix):
            return prefix
    
    return k_lower


def is_bank_key(key: str, transfer_graph: Dict = None) -> bool:
    """
    Check if a key represents a bank/credit card program (transferable points).
    """
    if not isinstance(key, str):
        return False
    
    k_lower = key.lower()
    
    # Direct match in transfer_graph
    if transfer_graph and k_lower in transfer_graph:
        return True
    
    # Check default transfer graph
    if k_lower in DEFAULT_TRANSFER_GRAPH:
        return True
    
    # Check if key matches any bank name mapping
    k_normalized = k_lower.replace(" ", "_")
    if k_normalized in BANK_NAME_MAPPINGS:
        return True
    
    # Check prefixes
    for prefix in BANK_PREFIXES:
        if k_lower.startswith(prefix):
            return True
    
    return False
