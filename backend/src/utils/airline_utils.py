"""
Utilities for inferring airline from flight numbers and normalizing airline codes.
Used when edges lack points_program (e.g. cash-only SERP legs) for card benefit matching.
"""

import re
from typing import Optional

# Common US and major global airline IATA codes (2-letter prefix of flight number)
_IATA_PREFIX = {
    "DL": "DL",  # Delta
    "AA": "AA",  # American
    "UA": "UA",  # United
    "WN": "WN",  # Southwest
    "B6": "B6",  # JetBlue
    "AS": "AS",  # Alaska
    "NK": "NK",  # Spirit
    "F9": "F9",  # Frontier
    "HA": "HA",  # Hawaiian
    "G4": "G4",  # Allegiant
    "AF": "AF",  # Air France
    "KL": "KL",  # KLM
    "BA": "BA",  # British Airways
    "LH": "LH",  # Lufthansa
    "AC": "AC",  # Air Canada
    "EK": "EK",  # Emirates
    "SQ": "SQ",  # Singapore
    "CX": "CX",  # Cathay Pacific
    "QF": "QF",  # Qantas
    "IB": "IB",  # Iberia
    "AZ": "AZ",  # ITA Airways
    "JL": "JL",  # Japan Airlines
    "NH": "NH",  # ANA
    "TK": "TK",  # Turkish
    "QR": "QR",  # Qatar
    "EY": "EY",  # Etihad
    "VS": "VS",  # Virgin Atlantic
    "FR": "FR",  # Ryanair
    "U2": "U2",  # easyJet
    "AV": "AV",  # Avianca
    "CM": "CM",  # Copa
}


def infer_airline_from_flight_number(flight_number: str) -> Optional[str]:
    """
    Infer IATA airline code from flight number (e.g. DL123 -> DL, AA456 -> AA).
    Returns 2-letter uppercase code or None if unknown.
    """
    if not flight_number or not isinstance(flight_number, str):
        return None
    fn = re.sub(r"\s+", "", str(flight_number).strip().upper())
    if len(fn) < 2:
        return None
    prefix = fn[:2]
    if prefix in _IATA_PREFIX:
        return prefix
    # Heuristic: if first 2 chars are letters, use as IATA (covers most majors)
    if prefix.isalpha():
        return prefix
    return None
