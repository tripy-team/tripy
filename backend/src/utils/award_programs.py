"""
Award programs and transfer graph for flights ILP and AwardTool.
Previously in src.data.award_programs; moved to src.utils to avoid .gitignore data/.
"""

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
DEFAULT_TRANSFER_GRAPH = {
    b: {a: 1.0 for a in _AIRLINE_PROGRAMS}
    for b in _BANKS
}


def get_award_programs_for_api() -> list:
    """Return list of 2-letter airline program codes for AwardTool / SerpAPI flows."""
    return list(_AIRLINE_PROGRAMS)
