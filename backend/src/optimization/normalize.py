"""
Normalization layer for program and bank identifiers.

CRITICAL: Without this, you'll have "united" vs "UA" vs "MileagePlus" bugs.

All keys in the optimization system should be normalized before use.
"""

from typing import Dict, Optional


# =============================================================================
# PROGRAM ALIASES (airline loyalty programs)
# =============================================================================

PROGRAM_ALIASES: Dict[str, str] = {
    # United
    "UA": "united",
    "UAL": "united",
    "MileagePlus": "united",
    "mileageplus": "united",
    "united": "united",
    "united_mileageplus": "united",
    
    # American
    "AA": "american",
    "AAL": "american",
    "AAdvantage": "american",
    "aadvantage": "american",
    "american": "american",
    "american_aadvantage": "american",
    
    # Delta
    "DL": "delta",
    "DAL": "delta",
    "SkyMiles": "delta",
    "skymiles": "delta",
    "delta": "delta",
    "delta_skymiles": "delta",
    
    # Southwest
    "WN": "southwest",
    "SWA": "southwest",
    "RapidRewards": "southwest",
    "southwest": "southwest",
    
    # Alaska
    "AS": "alaska",
    "ASA": "alaska",
    "MileagePlan": "alaska",
    "alaska": "alaska",
    
    # JetBlue
    "B6": "jetblue",
    "JBU": "jetblue",
    "TrueBlue": "jetblue",
    "jetblue": "jetblue",
    
    # British Airways
    "BA": "british_airways",
    "BAW": "british_airways",
    "Avios": "british_airways",
    "avios": "british_airways",
    "british_airways": "british_airways",
    
    # Air France / KLM
    "AF": "flying_blue",
    "KL": "flying_blue",
    "FlyingBlue": "flying_blue",
    "flying_blue": "flying_blue",
    
    # Singapore
    "SQ": "singapore",
    "SIA": "singapore",
    "KrisFlyer": "singapore",
    "krisflyer": "singapore",
    "singapore": "singapore",
    
    # ANA
    "NH": "ana",
    "ANA": "ana",
    "ana": "ana",
    "ana_mileage_club": "ana",
    
    # Turkish
    "TK": "turkish",
    "THY": "turkish",
    "MilesSmiles": "turkish",
    "turkish": "turkish",
    
    # Virgin Atlantic
    "VS": "virgin_atlantic",
    "VIR": "virgin_atlantic",
    "virgin_atlantic": "virgin_atlantic",
    
    # Emirates
    "EK": "emirates",
    "UAE": "emirates",
    "Skywards": "emirates",
    "emirates": "emirates",
    
    # Qantas
    "QF": "qantas",
    "QFA": "qantas",
    "qantas": "qantas",
    
    # Cathay Pacific
    "CX": "cathay",
    "CPA": "cathay",
    "AsiaMiles": "cathay",
    "cathay": "cathay",
    
    # Air Canada
    "AC": "aeroplan",
    "ACA": "aeroplan",
    "Aeroplan": "aeroplan",
    "aeroplan": "aeroplan",
    
    # Avianca
    "AV": "avianca",
    "AVA": "avianca",
    "LifeMiles": "avianca",
    "lifemiles": "avianca",
    "avianca": "avianca",
    
    # Etihad
    "EY": "etihad",
    "ETD": "etihad",
    "etihad": "etihad",
    
    # Japan Airlines
    "JL": "jal",
    "JAL": "jal",
    "jal": "jal",
    
    # Iberia
    "IB": "iberia",
    "IBE": "iberia",
    "iberia": "iberia",
    
    # ═══════════════════════════════════════════════════════════════════════
    # HOTEL PROGRAMS
    # ═══════════════════════════════════════════════════════════════════════
    
    # Hyatt
    "HYATT": "hyatt",
    "Hyatt": "hyatt",
    "hyatt": "hyatt",
    "WorldOfHyatt": "hyatt",
    "world_of_hyatt": "hyatt",
    "WOH": "hyatt",
    
    # Marriott
    "MARRIOTT": "marriott",
    "Marriott": "marriott",
    "marriott": "marriott",
    "MAR": "marriott",
    "Bonvoy": "marriott",
    "bonvoy": "marriott",
    "marriott_bonvoy": "marriott",
    
    # Hilton
    "HILTON": "hilton",
    "Hilton": "hilton",
    "hilton": "hilton",
    "HH": "hilton",
    "HiltonHonors": "hilton",
    "hilton_honors": "hilton",
    
    # IHG
    "IHG": "ihg",
    "ihg": "ihg",
    "IHGOneRewards": "ihg",
    "ihg_one_rewards": "ihg",
}


# =============================================================================
# BANK ALIASES (transferable points programs)
# =============================================================================

BANK_ALIASES: Dict[str, str] = {
    # Chase
    "CHASE": "chase",
    "Chase": "chase",
    "chase": "chase",
    "UR": "chase",
    "UltimateRewards": "chase",
    "ultimate_rewards": "chase",
    "chase_ultimate_rewards": "chase",
    
    # Amex
    "AMEX": "amex",
    "Amex": "amex",
    "amex": "amex",
    "MR": "amex",
    "MembershipRewards": "amex",
    "membership_rewards": "amex",
    "amex_membership_rewards": "amex",
    "American Express": "amex",
    
    # Citi
    "CITI": "citi",
    "Citi": "citi",
    "citi": "citi",
    "ThankYou": "citi",
    "thankyou": "citi",
    "citi_thankyou": "citi",
    "citi_thank_you": "citi",
    
    # Capital One
    "CAPITALONE": "capital_one",
    "CapitalOne": "capital_one",
    "capital_one": "capital_one",
    "capitalone": "capital_one",
    "C1": "capital_one",
    "CapOne": "capital_one",
    "capone": "capital_one",
    
    # Bilt
    "BILT": "bilt",
    "Bilt": "bilt",
    "bilt": "bilt",
    "BiltRewards": "bilt",
    "bilt_rewards": "bilt",
}


# =============================================================================
# AIRLINE CODE ALIASES (IATA 2-letter codes)
# =============================================================================

AIRLINE_ALIASES: Dict[str, str] = {
    # Map 3-letter ICAO to 2-letter IATA
    "UAL": "UA",
    "AAL": "AA",
    "DAL": "DL",
    "SWA": "WN",
    "ASA": "AS",
    "JBU": "B6",
    "BAW": "BA",
    "AFR": "AF",
    "KLM": "KL",
    "SIA": "SQ",
    "ANA": "NH",
    "THY": "TK",
    "VIR": "VS",
    "UAE": "EK",
    "QFA": "QF",
    "CPA": "CX",
    "ACA": "AC",
    "AVA": "AV",
    "ETD": "EY",
    "JAL": "JL",
    "IBE": "IB",
    
    # Already 2-letter codes - pass through
    "UA": "UA",
    "AA": "AA",
    "DL": "DL",
    "WN": "WN",
    "AS": "AS",
    "B6": "B6",
    "BA": "BA",
    "AF": "AF",
    "KL": "KL",
    "SQ": "SQ",
    "NH": "NH",
    "TK": "TK",
    "VS": "VS",
    "EK": "EK",
    "QF": "QF",
    "CX": "CX",
    "AC": "AC",
    "AV": "AV",
    "EY": "EY",
    "JL": "JL",
    "IB": "IB",
}


# =============================================================================
# NORMALIZATION FUNCTIONS
# =============================================================================

def normalize_program(raw: str) -> str:
    """
    Normalize program identifier to canonical form.
    
    Examples:
        normalize_program("UA") -> "united"
        normalize_program("MileagePlus") -> "united"
        normalize_program("HYATT") -> "hyatt"
    """
    if not raw:
        return raw
    
    # Try direct lookup
    if raw in PROGRAM_ALIASES:
        return PROGRAM_ALIASES[raw]
    
    # Try lowercase
    lower = raw.lower()
    if lower in PROGRAM_ALIASES:
        return PROGRAM_ALIASES[lower]
    
    # Try with underscores
    underscored = lower.replace(" ", "_").replace("-", "_")
    if underscored in PROGRAM_ALIASES:
        return PROGRAM_ALIASES[underscored]
    
    # Return lowercase as default
    return lower


def normalize_bank(raw: str) -> str:
    """
    Normalize bank identifier to canonical form.
    
    Examples:
        normalize_bank("CHASE") -> "chase"
        normalize_bank("Ultimate Rewards") -> "chase"
        normalize_bank("MR") -> "amex"
    """
    if not raw:
        return raw
    
    # Try direct lookup
    if raw in BANK_ALIASES:
        return BANK_ALIASES[raw]
    
    # Try lowercase
    lower = raw.lower()
    if lower in BANK_ALIASES:
        return BANK_ALIASES[lower]
    
    # Try with underscores
    underscored = lower.replace(" ", "_").replace("-", "_")
    if underscored in BANK_ALIASES:
        return BANK_ALIASES[underscored]
    
    # Return lowercase as default
    return lower


def normalize_airline(raw: str) -> str:
    """
    Normalize airline code to 2-letter IATA code.
    
    Examples:
        normalize_airline("UAL") -> "UA"
        normalize_airline("ua") -> "UA"
    """
    if not raw:
        return raw
    
    upper = raw.upper()
    
    # Try direct lookup
    if upper in AIRLINE_ALIASES:
        return AIRLINE_ALIASES[upper]
    
    # If already 2-letter, return uppercase
    if len(upper) == 2:
        return upper
    
    # Return first 2 chars uppercase as fallback
    return upper[:2]


def is_bank_program(key: str) -> bool:
    """Check if a key represents a bank/transferable points program."""
    if not key:
        return False
    
    normalized = normalize_bank(key)
    return normalized in {"chase", "amex", "citi", "capital_one", "bilt"}


def is_hotel_program(key: str) -> bool:
    """Check if a key represents a hotel loyalty program."""
    if not key:
        return False
    
    normalized = normalize_program(key)
    return normalized in {"hyatt", "marriott", "hilton", "ihg"}


def is_airline_program(key: str) -> bool:
    """Check if a key represents an airline loyalty program."""
    if not key:
        return False
    
    normalized = normalize_program(key)
    return normalized not in {"hyatt", "marriott", "hilton", "ihg"} and not is_bank_program(key)


def get_program_display_name(normalized_key: str) -> str:
    """Get display name for a normalized program key."""
    DISPLAY_NAMES = {
        "united": "United MileagePlus",
        "american": "American AAdvantage",
        "delta": "Delta SkyMiles",
        "southwest": "Southwest Rapid Rewards",
        "alaska": "Alaska Mileage Plan",
        "jetblue": "JetBlue TrueBlue",
        "british_airways": "British Airways Avios",
        "flying_blue": "Air France/KLM Flying Blue",
        "singapore": "Singapore KrisFlyer",
        "ana": "ANA Mileage Club",
        "turkish": "Turkish Miles&Smiles",
        "virgin_atlantic": "Virgin Atlantic Flying Club",
        "emirates": "Emirates Skywards",
        "qantas": "Qantas Frequent Flyer",
        "cathay": "Cathay Pacific Asia Miles",
        "aeroplan": "Air Canada Aeroplan",
        "avianca": "Avianca LifeMiles",
        "etihad": "Etihad Guest",
        "jal": "Japan Airlines Mileage Bank",
        "iberia": "Iberia Plus",
        "hyatt": "World of Hyatt",
        "marriott": "Marriott Bonvoy",
        "hilton": "Hilton Honors",
        "ihg": "IHG One Rewards",
    }
    return DISPLAY_NAMES.get(normalized_key, normalized_key.replace("_", " ").title())


def get_bank_display_name(normalized_key: str) -> str:
    """Get display name for a normalized bank key."""
    DISPLAY_NAMES = {
        "chase": "Chase Ultimate Rewards",
        "amex": "Amex Membership Rewards",
        "citi": "Citi ThankYou Points",
        "capital_one": "Capital One Miles",
        "bilt": "Bilt Rewards",
    }
    return DISPLAY_NAMES.get(normalized_key, normalized_key.replace("_", " ").title())
