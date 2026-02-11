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

# Centralized program config (single source of truth)
from src.config.programs import (
    DEFAULT_TRANSFER_GRAPH,
    AIRLINE_PROGRAMS_LIST as _AIRLINE_PROGRAMS,
    BANK_PREFIXES as _BANKS,
    ALLIANCE_PARTNERS,
    HIGH_SURCHARGE_PROGRAMS,
)

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


# ALLIANCE_PARTNERS is now imported from src.config.programs


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


# HIGH_SURCHARGE_PROGRAMS is now imported from src.config.programs


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
