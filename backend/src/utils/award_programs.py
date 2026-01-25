"""
Award programs and transfer graph for flights ILP and AwardTool.
Previously in src.data.award_programs; moved to src.utils to avoid .gitignore data/.

Enhanced with:
- Program-specific CPP thresholds
- Partner award support
- Transfer bonus tracking
- Alliance partnerships
"""

from typing import Dict, List, Set, Tuple, Optional
from datetime import datetime

# AwardTool 2-letter program codes to query (US + major international with good coverage)
_AIRLINE_PROGRAMS = [
    "UA", "AA", "DL",  # US majors
    "AS", "B6",        # Alaska, JetBlue
    "AC", "BA", "AF", "KL",  # North Atlantic
    "LH", "LX",        # Lufthansa, Swiss
    "SQ", "CX", "NH", "JL",  # Asia
    "EK", "QR", "EY", "TK",  # Middle East, Turkey
    "AV", "IB", "QF", "VS",  # Avianca, Iberia, Qantas, Virgin Atlantic
]

# Banks (lowercase) -> { airline: transfer_ratio }
# Used by ilp_adapter to know which bank points can transfer to which airlines.
# Ratio 1.0 = 1:1; e.g. 1.25 = bonus.
_BANKS = ["amex", "chase", "citi", "capitalone", "bilt"]

# =============================================================================
# TRANSFER GRAPH WITH ACTUAL PARTNER RELATIONSHIPS
# =============================================================================

# Note: Not all banks transfer to all airlines. This is the ACTUAL transfer graph.
DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = {
    "amex": {
        # Airline partners (Membership Rewards)
        "DL": 1.0, "BA": 1.0, "AF": 1.0, "VS": 1.0, "SQ": 1.0,
        "AV": 1.0, "IB": 1.0, "CX": 1.0, "EK": 1.0, "EY": 1.0,
        "QR": 1.0, "NH": 1.0, "AC": 1.0, "JL": 1.0, "QF": 1.0,
        "KL": 1.0, "AS": 1.0,
    },
    "chase": {
        # Airline partners (Ultimate Rewards)
        "UA": 1.0, "BA": 1.0, "AF": 1.0, "VS": 1.0, "SQ": 1.0,
        "IB": 1.0, "AC": 1.0, "KL": 1.0, "JL": 1.0, "EK": 1.0,
        "AS": 1.0,  # Added 2023
    },
    "citi": {
        # Airline partners (ThankYou Points)
        "AA": 1.0, "TK": 1.0, "QF": 1.0, "VS": 1.0, "SQ": 1.0,
        "EY": 1.0, "AF": 1.0, "CX": 1.0, "EK": 1.0, "QR": 1.0,
        "AV": 1.0, "TG": 1.0, "JL": 1.0, "AC": 1.0,
    },
    "capitalone": {
        # Airline partners (Capital One Miles) - note: some are NOT 1:1
        "AF": 1.0, "BA": 0.75, "AV": 1.0, "SQ": 1.0, "EK": 1.0,
        "EY": 1.0, "QF": 1.0, "QR": 1.0, "VS": 1.0, "TK": 1.0,
        "CX": 1.0, "FJ": 1.0, "TP": 1.0, "AS": 1.0,
    },
    "bilt": {
        # Airline partners (Bilt Rewards)
        "UA": 1.0, "AA": 1.0, "BA": 1.0, "AF": 1.0, "VS": 1.0,
        "AV": 1.0, "IB": 1.0, "CX": 1.0, "EK": 1.0, "EY": 1.0,
        "AC": 1.0, "AS": 1.0, "TK": 1.0, "TP": 1.0,
    },
}

# =============================================================================
# CPP THRESHOLDS BY PROGRAM
# =============================================================================

# Program-specific minimum CPP thresholds for redemption
# Higher thresholds for programs with high surcharges
PROGRAM_CPP_THRESHOLDS: Dict[str, float] = {
    # Premium long-haul - higher expected value
    "SQ": 1.5, "NH": 1.5, "JL": 1.4, "VS": 1.3, "CX": 1.3,
    # US Domestic - lower thresholds
    "UA": 1.0, "AA": 1.0, "DL": 1.0, "AS": 1.1, "B6": 0.9,
    # High-surcharge programs
    "BA": 1.8, "LH": 1.6, "LX": 1.6, "KL": 1.4, "AF": 1.3,
    # Middle East
    "EK": 1.2, "QR": 1.3, "EY": 1.2, "TK": 1.2,
    # Other
    "AC": 1.2, "AV": 1.4, "IB": 1.3, "QF": 1.3,
}

DEFAULT_CPP_THRESHOLD = 1.0


def get_cpp_threshold(program: str) -> float:
    """Get minimum CPP threshold for a program."""
    return PROGRAM_CPP_THRESHOLDS.get(program.upper(), DEFAULT_CPP_THRESHOLD)


# =============================================================================
# ALLIANCE PARTNERSHIPS
# =============================================================================

ALLIANCE_PARTNERS: Dict[str, List[str]] = {
    # Star Alliance
    "UA": ["AC", "LH", "TK", "SQ", "NH", "AV", "LX"],
    "LH": ["UA", "AC", "TK", "SQ", "NH", "AV", "LX"],
    "AC": ["UA", "LH", "TK", "SQ", "NH", "AV", "LX"],
    "SQ": ["UA", "AC", "LH", "TK", "NH", "AV", "LX"],
    "NH": ["UA", "AC", "LH", "TK", "SQ", "AV", "LX"],
    # Oneworld
    "AA": ["BA", "IB", "QF", "CX", "QR", "AS"],
    "BA": ["AA", "IB", "QF", "CX", "QR", "AS"],
    "QF": ["AA", "BA", "IB", "CX", "QR", "AS"],
    "CX": ["AA", "BA", "IB", "QF", "QR", "AS"],
    "AS": ["AA", "BA", "QF", "CX"],
    # SkyTeam
    "DL": ["AF", "KL", "VS", "KE"],
    "AF": ["DL", "KL", "VS", "KE"],
    "KL": ["DL", "AF", "VS", "KE"],
    "VS": ["DL", "AF", "KL"],
}


def get_partner_programs(operating_carrier: str) -> List[str]:
    """Get programs that can book flights on this carrier."""
    partners = ALLIANCE_PARTNERS.get(operating_carrier.upper(), [])
    return [operating_carrier.upper()] + [p for p in partners if p != operating_carrier.upper()]


# =============================================================================
# TRANSFER BONUSES
# =============================================================================

# Active transfer bonuses (updated periodically)
# Format: {(bank, airline): {"bonus_pct": 30, "end_date": "2025-03-31"}}
ACTIVE_TRANSFER_BONUSES: Dict[Tuple[str, str], Dict] = {}


def get_transfer_bonus(bank: str, airline: str) -> Optional[float]:
    """
    Get active transfer bonus percentage (e.g., 30 for 30% bonus).
    Returns None if no active bonus.
    """
    key = (bank.lower(), airline.upper())
    bonus_data = ACTIVE_TRANSFER_BONUSES.get(key)
    if not bonus_data:
        return None
    
    # Check if still active
    end_date_str = bonus_data.get("end_date")
    if end_date_str:
        try:
            end_date = datetime.strptime(end_date_str, "%Y-%m-%d")
            if datetime.now() > end_date:
                return None
        except ValueError:
            pass
    
    return bonus_data.get("bonus_pct")


def get_effective_transfer_ratio(bank: str, airline: str) -> Optional[float]:
    """
    Get effective transfer ratio including any active bonus.
    Returns None if bank cannot transfer to airline.
    """
    base_ratio = DEFAULT_TRANSFER_GRAPH.get(bank.lower(), {}).get(airline.upper())
    if base_ratio is None:
        return None
    
    bonus_pct = get_transfer_bonus(bank, airline)
    if bonus_pct:
        return base_ratio * (1 + bonus_pct / 100)
    return base_ratio


def can_transfer(bank: str, airline: str) -> bool:
    """Check if bank can transfer to airline."""
    return airline.upper() in DEFAULT_TRANSFER_GRAPH.get(bank.lower(), {})


# =============================================================================
# HIGH SURCHARGE PROGRAMS
# =============================================================================

HIGH_SURCHARGE_PROGRAMS: Set[str] = {"BA", "LH", "LX", "QF", "SQ", "VS"}


def is_high_surcharge_program(program: str) -> bool:
    """Check if program typically has high surcharges."""
    return program.upper() in HIGH_SURCHARGE_PROGRAMS


# =============================================================================
# PARTNER SURCHARGE OVERRIDES
# =============================================================================

# When booking via partner program, surcharges may be different
# Key: (operating_carrier, booking_program), Value: typical surcharge
PARTNER_SURCHARGE_OVERRIDES: Dict[Tuple[str, str], float] = {
    ("BA", "AA"): 50,   # BA metal via AA has low surcharges
    ("BA", "AS"): 50,   # BA metal via Alaska
    ("LH", "UA"): 30,   # Lufthansa via United
    ("LX", "UA"): 30,   # Swiss via United
    ("AF", "DL"): 50,   # Air France via Delta
    ("KL", "DL"): 50,   # KLM via Delta
    ("SQ", "UA"): 30,   # Singapore via United (no fuel surcharges)
    ("SQ", "AC"): 30,   # Singapore via Aeroplan
}


def get_partner_surcharge(operating_carrier: str, booking_program: str, default: float) -> float:
    """Get expected surcharge when booking via partner program."""
    key = (operating_carrier.upper(), booking_program.upper())
    return PARTNER_SURCHARGE_OVERRIDES.get(key, default)


def get_award_programs_for_api() -> list:
    """Return list of 2-letter airline program codes for AwardTool / SerpAPI flows."""
    return list(_AIRLINE_PROGRAMS)


def get_all_banks() -> list:
    """Return list of supported bank programs."""
    return list(_BANKS)
