"""
Fair Market Values for Points Programs

Industry-standard cents-per-point (CPP) valuations for settling group trip costs.
These values represent conservative fair market rates for points redemptions.
"""

from typing import Dict, Optional


# =============================================================================
# FAIR MARKET VALUES (Cents Per Point)
# =============================================================================

FAIR_MARKET_VALUES_CPP: Dict[str, float] = {
    # ═══════════════════════════════════════════════════════════════════════
    # BANK/CREDIT CARD PROGRAMS (Transferable Points)
    # Higher value due to transfer flexibility
    # ═══════════════════════════════════════════════════════════════════════
    "chase": 1.5,           # Chase Ultimate Rewards
    "amex": 1.5,            # American Express Membership Rewards
    "citi": 1.5,            # Citi ThankYou Points
    "capitalone": 1.5,      # Capital One Miles
    "bilt": 1.5,            # Bilt Rewards
    
    # ═══════════════════════════════════════════════════════════════════════
    # US DOMESTIC AIRLINES
    # ═══════════════════════════════════════════════════════════════════════
    "UA": 1.3,              # United MileagePlus
    "AA": 1.4,              # American AAdvantage  
    "DL": 1.2,              # Delta SkyMiles (lower due to variable pricing)
    "WN": 1.5,              # Southwest Rapid Rewards (fixed value)
    "B6": 1.3,              # JetBlue TrueBlue
    "AS": 1.8,              # Alaska Mileage Plan (excellent value)
    
    # ═══════════════════════════════════════════════════════════════════════
    # INTERNATIONAL AIRLINES
    # ═══════════════════════════════════════════════════════════════════════
    "BA": 1.3,              # British Airways Avios
    "AF": 1.3,              # Air France Flying Blue
    "KL": 1.3,              # KLM Flying Blue (same as AF)
    "SQ": 1.5,              # Singapore KrisFlyer
    "NH": 1.5,              # ANA Mileage Club
    "JL": 1.4,              # JAL Mileage Bank
    "CX": 1.4,              # Cathay Pacific Asia Miles
    "EK": 1.3,              # Emirates Skywards
    "QR": 1.4,              # Qatar Airways Privilege Club
    "VS": 1.4,              # Virgin Atlantic Flying Club
    "TK": 1.4,              # Turkish Miles&Smiles
    "AC": 1.5,              # Air Canada Aeroplan
    "AV": 1.3,              # Avianca LifeMiles
    "EY": 1.3,              # Etihad Guest
    "QF": 1.4,              # Qantas Frequent Flyer
    "IB": 1.3,              # Iberia Plus
    "LH": 1.0,              # Lufthansa Miles & More (surcharges)
    "LX": 1.0,              # Swiss Miles & More
    "EI": 1.2,              # Aer Lingus AerClub
    "AY": 1.3,              # Finnair Plus
    "TAP": 1.2,             # TAP Miles&Go
    
    # ═══════════════════════════════════════════════════════════════════════
    # HOTEL PROGRAMS
    # ═══════════════════════════════════════════════════════════════════════
    "HH": 0.5,              # Hilton Honors (high point requirements)
    "MAR": 0.8,             # Marriott Bonvoy
    "HYATT": 1.7,           # World of Hyatt (excellent value)
    "IHG": 0.5,             # IHG One Rewards
    "WYNDHAM": 0.9,         # Wyndham Rewards
    "CHOICE": 0.6,          # Choice Privileges
    "ACC": 0.6,             # Accor Live Limitless
}


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_cpp(program: str) -> float:
    """
    Get the CPP value for a program.
    
    Args:
        program: Program code (e.g., "chase", "UA", "HH")
        
    Returns:
        CPP value as float (default 1.0 if not found)
    """
    # Try uppercase first (airlines/hotels), then lowercase (banks)
    cpp = FAIR_MARKET_VALUES_CPP.get(program.upper())
    if cpp is None:
        cpp = FAIR_MARKET_VALUES_CPP.get(program.lower())
    if cpp is None:
        cpp = 1.0  # Default fallback
    return cpp


def get_fair_market_value(program: str, points: int) -> float:
    """
    Calculate the USD value of points using Fair Market Value.
    
    Formula: USD_Value = (points × CPP) / 100
    
    Args:
        program: Program code (e.g., "chase", "UA", "HH")
        points: Number of points
        
    Returns:
        USD value as float
        
    Examples:
        >>> get_fair_market_value("chase", 100000)
        1500.0  # 100K Chase points = $1,500
        
        >>> get_fair_market_value("HH", 100000)
        500.0   # 100K Hilton points = $500
        
        >>> get_fair_market_value("HYATT", 100000)
        1700.0  # 100K Hyatt points = $1,700
    """
    cpp = get_cpp(program)
    return (points * cpp) / 100


def get_program_cpp_info(program: str) -> Dict[str, any]:
    """
    Get detailed CPP information for a program.
    
    Args:
        program: Program code
        
    Returns:
        Dict with cpp value and tier classification
    """
    cpp = get_cpp(program)
    
    # Classify into tiers for UI display
    if cpp >= 1.5:
        tier = "excellent"
        description = "Excellent value program"
    elif cpp >= 1.2:
        tier = "good"
        description = "Good value program"
    elif cpp >= 0.8:
        tier = "average"
        description = "Average value program"
    else:
        tier = "below_average"
        description = "Below average value, high point requirements"
    
    return {
        "program": program,
        "cpp": cpp,
        "tier": tier,
        "description": description,
        "example_10k": get_fair_market_value(program, 10000),
        "example_100k": get_fair_market_value(program, 100000),
    }


def calculate_actual_cpp(
    cash_price: float,
    points_cost: int,
    surcharge: float = 0.0,
) -> float:
    """
    Calculate the actual CPP achieved for a specific redemption.
    
    Formula: Actual_CPP = (Cash_Price - Surcharge) / Points_Cost * 100
    
    Args:
        cash_price: Cash price of the item in USD
        points_cost: Points required for redemption
        surcharge: Cash surcharge/taxes still required
        
    Returns:
        Actual CPP achieved (cents per point)
        
    Example:
        >>> calculate_actual_cpp(cash_price=2000, points_cost=100000, surcharge=100)
        1.9  # (2000 - 100) / 100000 * 100 = 1.9 cpp
    """
    if points_cost <= 0:
        return 0.0
    
    cash_saved = cash_price - surcharge
    return round((cash_saved / points_cost) * 100, 2)


def compare_redemption_value(
    cash_price: float,
    points_cost: int,
    surcharge: float,
    program: str,
) -> Dict[str, any]:
    """
    Compare actual redemption value to fair market value.
    
    Args:
        cash_price: Cash price in USD
        points_cost: Points required
        surcharge: Cash surcharge
        program: Program code
        
    Returns:
        Dict with comparison metrics
    """
    actual_cpp = calculate_actual_cpp(cash_price, points_cost, surcharge)
    fair_cpp = get_cpp(program)
    fair_value = get_fair_market_value(program, points_cost)
    actual_value = cash_price - surcharge
    
    is_good_deal = actual_cpp >= fair_cpp
    value_difference = actual_value - fair_value
    value_ratio = actual_cpp / fair_cpp if fair_cpp > 0 else 0
    
    return {
        "actual_cpp": actual_cpp,
        "fair_market_cpp": fair_cpp,
        "actual_value": actual_value,
        "fair_market_value": fair_value,
        "is_good_deal": is_good_deal,
        "value_difference": round(value_difference, 2),
        "value_ratio": round(value_ratio, 2),  # > 1.0 means better than average
        "verdict": (
            "Excellent redemption" if value_ratio >= 1.5 else
            "Good redemption" if value_ratio >= 1.0 else
            "Below average redemption"
        ),
    }


def get_all_program_values() -> Dict[str, Dict]:
    """
    Get all programs with their CPP values and classifications.
    
    Returns:
        Dict mapping program codes to their value info
    """
    return {
        program: get_program_cpp_info(program)
        for program in FAIR_MARKET_VALUES_CPP.keys()
    }
