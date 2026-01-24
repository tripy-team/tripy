"""
Loyalty programs enum and validation
Matches the frontend enum in frontend/src/lib/loyalty-programs.ts
"""

from enum import Enum
from typing import Optional

class LoyaltyProgram(str, Enum):
    """Supported loyalty programs"""
    # Credit Card Programs
    CHASE_ULTIMATE_REWARDS = "Chase Ultimate Rewards"
    AMEX_MEMBERSHIP_REWARDS = "Amex Membership Rewards"
    CITI_THANKYOU_POINTS = "Citi ThankYou Points"
    CAPITAL_ONE_MILES = "Capital One Miles"
    DISCOVER_MILES = "Discover Miles"
    BANK_OF_AMERICA_POINTS = "Bank of America Points"
    US_BANK_REWARDS = "US Bank Rewards"
    WELLS_FARGO_POINTS = "Wells Fargo Points"

    # Hotel Programs
    MARRIOTT_BONVOY = "Marriott Bonvoy"
    HILTON_HONORS = "Hilton Honors"
    HYATT_WORLD_OF_HYATT = "Hyatt World of Hyatt"
    IHG_REWARDS = "IHG Rewards"
    RADISSON_REWARDS = "Radisson Rewards"
    WYNDHAM_REWARDS = "Wyndham Rewards"
    CHOICE_PRIVILEGES = "Choice Privileges"
    BEST_WESTERN_REWARDS = "Best Western Rewards"
    ACCOR_LIVE_LIMITLESS = "Accor Live Limitless"
    MGM_REWARDS = "MGM Rewards"
    CAESARS_REWARDS = "Caesars Rewards"

    # Airline Programs (US)
    DELTA_SKYMILES = "Delta SkyMiles"
    UNITED_MILEAGEPLUS = "United MileagePlus"
    AMERICAN_AIRLINES_AADVANTAGE = "American Airlines AAdvantage"
    SOUTHWEST_RAPID_REWARDS = "Southwest Rapid Rewards"
    ALASKA_MILEAGE_PLAN = "Alaska Mileage Plan"
    JETBLUE_TRUEBLUE = "JetBlue TrueBlue"
    SPIRIT_FREESPIRIT = "Spirit FreeSpirit"
    FRONTIER_MILES = "Frontier Miles"
    HAWAIIAN_MILES = "Hawaiian Miles"

    # Airline Programs (International - Major)
    BRITISH_AIRWAYS_AVIOS = "British Airways Avios"
    AIR_FRANCE_KLM_FLYING_BLUE = "Air France-KLM Flying Blue"
    LUFTHANSA_MILES_MORE = "Lufthansa Miles & More"
    AEROPLAN = "Aeroplan"
    AVIANCA_LIFEMILES = "Avianca LifeMiles"
    SINGAPORE_AIRLINES_KRISFLYER = "Singapore Airlines KrisFlyer"
    QANTAS_FREQUENT_FLYER = "Qantas Frequent Flyer"
    EMIRATES_SKYWARDS = "Emirates Skywards"
    CATHAY_PACIFIC_ASIA_MILES = "Cathay Pacific Asia Miles"
    JAPAN_AIRLINES_MILEAGE_BANK = "Japan Airlines Mileage Bank"
    ALL_NIPPON_AIRWAYS_MILEAGE_CLUB = "All Nippon Airways Mileage Club"
    KOREAN_AIR_SKYPASS = "Korean Air Skypass"
    ASIANA_CLUB = "Asiana Club"
    VIRGIN_ATLANTIC_FLYING_CLUB = "Virgin Atlantic Flying Club"
    VIRGIN_AUSTRALIA_VELOCITY = "Virgin Australia Velocity"
    QATAR_PRIVILEGE_CLUB = "Qatar Privilege Club"
    ETIHAD_GUEST = "Etihad Guest"
    TURKISH_AIRLINES_MILES_SMILES = "Turkish Airlines Miles&Smiles"


# Set of all valid program values
VALID_PROGRAMS = {program.value for program in LoyaltyProgram}


def is_valid_program(program: str) -> bool:
    """Check if a program string is valid"""
    return program in VALID_PROGRAMS


def validate_program(program: str) -> Optional[str]:
    """
    Validate and normalize a program string.
    Returns the validated program value, or None if invalid.
    """
    # Exact match
    if program in VALID_PROGRAMS:
        return program
    
    # Case-insensitive match
    program_lower = program.lower()
    for valid_program in VALID_PROGRAMS:
        if valid_program.lower() == program_lower:
            return valid_program
    
    return None
