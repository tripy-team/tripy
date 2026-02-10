"""
Transfer Strategy Module

Extended transfer graph supporting airline programs ONLY.
Provides utilities for computing optimal point transfers to minimize out-of-pocket costs.
"""

from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field


# =============================================================================
# EXTENDED TRANSFER GRAPH (Banks → Airlines ONLY)
# =============================================================================

EXTENDED_TRANSFER_GRAPH: Dict[str, Dict[str, Dict[str, Any]]] = {
    "amex": {
        # Airlines (Membership Rewards)
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "NH": {"ratio": 1.0, "type": "airline", "name": "ANA Mileage Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "JL": {"ratio": 1.0, "type": "airline", "name": "Japan Airlines Mileage Bank"},
    },
    "chase": {
        # Airlines (Ultimate Rewards)
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "EI": {"ratio": 1.0, "type": "airline", "name": "Aer Lingus AerClub"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "WN": {"ratio": 1.0, "type": "airline", "name": "Southwest Rapid Rewards"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
    },
    "citi": {
        # Airlines (ThankYou Points)
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "QR": {"ratio": 1.0, "type": "airline", "name": "Qatar Airways Privilege Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "JL": {"ratio": 1.0, "type": "airline", "name": "Japan Airlines Mileage Bank"},
    },
    "capitalone": {
        # Airlines
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "AY": {"ratio": 1.0, "type": "airline", "name": "Finnair Plus"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "TAP": {"ratio": 1.0, "type": "airline", "name": "TAP Miles&Go"},
    },
    "bilt": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "EI": {"ratio": 1.0, "type": "airline", "name": "Aer Lingus AerClub"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        "AS": {"ratio": 1.0, "type": "airline", "name": "Alaska Mileage Plan"},
    },
}

# Legacy transfer graph for backward compatibility (airlines only, simple ratio)
DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = {
    bank: {prog: info["ratio"] for prog, info in programs.items()}
    for bank, programs in EXTENDED_TRANSFER_GRAPH.items()
}


# =============================================================================
# TRANSFER METADATA (Portal URLs, Transfer Times, etc.)
# =============================================================================

BANK_METADATA: Dict[str, Dict[str, Any]] = {
    "amex": {
        "name": "American Express Membership Rewards",
        "portal_url": "https://global.americanexpress.com/rewards",
        "default_transfer_time": "1-2 business days",
        "block_size": 1000,
    },
    "chase": {
        "name": "Chase Ultimate Rewards",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "default_transfer_time": "instant",
        "block_size": 1000,
    },
    "citi": {
        "name": "Citi ThankYou Points",
        "portal_url": "https://thankyou.citi.com",
        "default_transfer_time": "instant to 24 hours",
        "block_size": 1000,
    },
    "capitalone": {
        "name": "Capital One Miles",
        "portal_url": "https://www.capitalone.com/credit-cards/benefits/travel/",
        "default_transfer_time": "instant to 2 days",
        "block_size": 1000,
    },
    "bilt": {
        "name": "Bilt Rewards",
        "portal_url": "https://www.biltrewards.com",
        "default_transfer_time": "instant",
        "block_size": 1000,
    },
    "bank_of_america": {
        "name": "Bank of America Points",
        "portal_url": "https://travel.bankofamerica.com",
        "default_transfer_time": "N/A (fixed-value portal redemption)",
        "block_size": 1,
        "fixed_value": True,
        "cpp": 1.0,
    },
    "wells_fargo": {
        "name": "Wells Fargo Points",
        "portal_url": "https://www.wellsfargo.com/rewards/",
        "default_transfer_time": "N/A (fixed-value portal redemption)",
        "block_size": 1,
        "fixed_value": True,
        "cpp": 1.0,
    },
    "discover": {
        "name": "Discover Miles",
        "portal_url": "https://www.discover.com/credit-cards/cashback-bonus/travel.html",
        "default_transfer_time": "N/A (fixed-value portal redemption)",
        "block_size": 1,
        "fixed_value": True,
        "cpp": 1.0,
    },
    "us_bank": {
        "name": "US Bank Rewards",
        "portal_url": "https://rewards.usbank.com",
        "default_transfer_time": "N/A (fixed-value portal redemption)",
        "block_size": 1,
        "fixed_value": True,
        "cpp": 1.5,
    },
}

# Program metadata - AIRLINES ONLY
PROGRAM_METADATA: Dict[str, Dict[str, Any]] = {
    "UA": {"name": "United MileagePlus", "type": "airline", "booking_url": "https://www.united.com"},
    "AA": {"name": "American AAdvantage", "type": "airline", "booking_url": "https://www.aa.com"},
    "DL": {"name": "Delta SkyMiles", "type": "airline", "booking_url": "https://www.delta.com"},
    "WN": {"name": "Southwest Rapid Rewards", "type": "airline", "booking_url": "https://www.southwest.com"},
    "B6": {"name": "JetBlue TrueBlue", "type": "airline", "booking_url": "https://www.jetblue.com"},
    "AS": {"name": "Alaska Mileage Plan", "type": "airline", "booking_url": "https://www.alaskaair.com"},
    "AF": {"name": "Air France / KLM Flying Blue", "type": "airline", "booking_url": "https://www.airfrance.com"},
    "BA": {"name": "British Airways Avios", "type": "airline", "booking_url": "https://www.britishairways.com"},
    "SQ": {"name": "Singapore KrisFlyer", "type": "airline", "booking_url": "https://www.singaporeair.com"},
    "CX": {"name": "Cathay Pacific Asia Miles", "type": "airline", "booking_url": "https://www.cathaypacific.com"},
    "NH": {"name": "ANA Mileage Club", "type": "airline", "booking_url": "https://www.ana.co.jp"},
    "JL": {"name": "JAL Mileage Bank", "type": "airline", "booking_url": "https://www.jal.co.jp"},
    "EK": {"name": "Emirates Skywards", "type": "airline", "booking_url": "https://www.emirates.com"},
    "QR": {"name": "Qatar Airways Privilege Club", "type": "airline", "booking_url": "https://www.qatarairways.com"},
    "EY": {"name": "Etihad Guest", "type": "airline", "booking_url": "https://www.etihad.com"},
    "TK": {"name": "Turkish Miles&Smiles", "type": "airline", "booking_url": "https://www.turkishairlines.com"},
    "AV": {"name": "Avianca LifeMiles", "type": "airline", "booking_url": "https://www.lifemiles.com"},
    "IB": {"name": "Iberia Plus", "type": "airline", "booking_url": "https://www.iberia.com"},
    "QF": {"name": "Qantas Frequent Flyer", "type": "airline", "booking_url": "https://www.qantas.com"},
    "VS": {"name": "Virgin Atlantic Flying Club", "type": "airline", "booking_url": "https://www.virginatlantic.com"},
    "AC": {"name": "Air Canada Aeroplan", "type": "airline", "booking_url": "https://www.aircanada.com"},
    "LH": {"name": "Lufthansa Miles & More", "type": "airline", "booking_url": "https://www.lufthansa.com"},
    "LX": {"name": "Swiss Miles & More", "type": "airline", "booking_url": "https://www.swiss.com"},
    "EI": {"name": "Aer Lingus AerClub", "type": "airline", "booking_url": "https://www.aerlingus.com"},
    "AY": {"name": "Finnair Plus", "type": "airline", "booking_url": "https://www.finnair.com"},
    "TAP": {"name": "TAP Miles&Go", "type": "airline", "booking_url": "https://www.flytap.com"},
}


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class TransferOption:
    """Represents a possible transfer from a bank to an airline program."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    program_type: str  # Always "airline"
    ratio: float  # Points received per bank point
    transfer_time: str
    portal_url: str
    booking_url: str


@dataclass
class TransferInstruction:
    """Step-by-step instructions for a point transfer."""
    from_program: str
    from_program_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    transfer_ratio: str  # e.g., "1:1"
    resulting_points: int
    transfer_time: str
    portal_url: str
    booking_url: str
    steps: List[str] = field(default_factory=list)


# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def is_bank_program(program: str) -> bool:
    """Check if a program code represents a bank (transferable points)."""
    return program.lower() in EXTENDED_TRANSFER_GRAPH


def get_bank_name(bank: str) -> str:
    """Get the display name for a bank."""
    return BANK_METADATA.get(bank.lower(), {}).get("name", bank.upper())


def get_program_name(program: str) -> str:
    """Get the display name for a program (airline)."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("name", program)


def get_program_type(program: str) -> Optional[str]:
    """Get the type of a program (always 'airline')."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("type")


def can_transfer(bank: str, program: str) -> bool:
    """Check if a bank can transfer to a specific airline program."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    return prog_upper in EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})


def get_transfer_ratio(bank: str, program: str) -> float:
    """Get the transfer ratio from bank to program (points received per bank point)."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    info = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {}).get(prog_upper, {})
    return info.get("ratio", 0.0)


def get_transfer_partners(bank: str) -> List[str]:
    """Get all airline programs a bank can transfer to."""
    bank_lower = bank.lower()
    programs = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})
    return list(programs.keys())


def get_all_transfer_options(available_points: Dict[str, int]) -> List[TransferOption]:
    """
    Get all possible transfer options given a user's point balances.
    
    Args:
        available_points: Dict mapping program codes to balances
        
    Returns:
        List of TransferOption objects
    """
    options = []
    
    for prog, balance in available_points.items():
        if balance <= 0:
            continue
            
        prog_lower = prog.lower()
        if prog_lower not in EXTENDED_TRANSFER_GRAPH:
            continue  # Not a bank with transfers
            
        bank_meta = BANK_METADATA.get(prog_lower, {})
        
        for target_prog, info in EXTENDED_TRANSFER_GRAPH[prog_lower].items():
            prog_meta = PROGRAM_METADATA.get(target_prog, {})
            
            options.append(TransferOption(
                from_bank=prog_lower,
                from_bank_name=bank_meta.get("name", prog),
                to_program=target_prog,
                to_program_name=info.get("name", target_prog),
                program_type="airline",
                ratio=info.get("ratio", 1.0),
                transfer_time=bank_meta.get("default_transfer_time", "varies"),
                portal_url=bank_meta.get("portal_url", ""),
                booking_url=prog_meta.get("booking_url", ""),
            ))
    
    return options


def build_transfer_instruction(
    bank: str,
    program: str,
    points_to_transfer: int,
    for_item: Optional[str] = None,
) -> TransferInstruction:
    """
    Build detailed transfer instructions.
    
    Args:
        bank: Source bank code
        program: Target airline program code
        points_to_transfer: Number of bank points to transfer
        for_item: Optional description of what this transfer is for
        
    Returns:
        TransferInstruction with step-by-step guide
    """
    bank_lower = bank.lower()
    prog_upper = program.upper()
    
    bank_meta = BANK_METADATA.get(bank_lower, {})
    prog_info = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {}).get(prog_upper, {})
    prog_meta = PROGRAM_METADATA.get(prog_upper, {})
    
    ratio = prog_info.get("ratio", 1.0)
    resulting_points = int(points_to_transfer * ratio)
    
    ratio_str = f"1:{int(ratio)}" if ratio >= 1.0 else f"{int(1/ratio)}:1"
    
    bank_name = bank_meta.get("name", bank)
    prog_name = prog_info.get("name", prog_meta.get("name", program))
    portal_url = bank_meta.get("portal_url", "")
    booking_url = prog_meta.get("booking_url", "")
    transfer_time = bank_meta.get("default_transfer_time", "varies")
    
    # Build step-by-step instructions
    steps = [
        f"1. Log in to your {bank_name} account",
        f"2. Navigate to the rewards portal: {portal_url}",
        f"3. Select 'Transfer Points' or 'Transfer to Partners'",
        f"4. Find and select {prog_name}",
        f"5. Enter your {prog_name} membership number",
        f"6. Transfer {points_to_transfer:,} points ({ratio_str} ratio, {transfer_time})",
        f"7. You will receive {resulting_points:,} {prog_name} points",
    ]
    
    if booking_url:
        steps.append(f"8. Book your flight at {booking_url} using your {prog_name} points")
    
    if for_item:
        steps.append(f"9. Use points for: {for_item}")
    
    return TransferInstruction(
        from_program=bank_lower,
        from_program_name=bank_name,
        to_program=prog_upper,
        to_program_name=prog_name,
        points_to_transfer=points_to_transfer,
        transfer_ratio=ratio_str,
        resulting_points=resulting_points,
        transfer_time=transfer_time,
        portal_url=portal_url,
        booking_url=booking_url,
        steps=steps,
    )


def compute_effective_balance(
    available_points: Dict[str, int],
    target_program: str,
) -> Tuple[int, List[Tuple[str, int, float]]]:
    """
    Compute the effective points balance for a target airline program,
    including transferable bank points.
    
    Args:
        available_points: User's point balances
        target_program: Target airline program code
        
    Returns:
        Tuple of (total_effective_points, [(source, points, ratio), ...])
    """
    prog_upper = target_program.upper()
    sources = []
    total = 0
    
    # Direct balance in the program
    direct = available_points.get(prog_upper, 0) + available_points.get(prog_upper.lower(), 0)
    if direct > 0:
        sources.append((prog_upper, direct, 1.0))
        total += direct
    
    # Transferable from banks
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower not in EXTENDED_TRANSFER_GRAPH:
            continue
        
        if prog_upper in EXTENDED_TRANSFER_GRAPH[bank_lower]:
            ratio = EXTENDED_TRANSFER_GRAPH[bank_lower][prog_upper].get("ratio", 1.0)
            effective = int(balance * ratio)
            sources.append((bank_lower, balance, ratio))
            total += effective
    
    return total, sources


def get_best_transfer_source(
    available_points: Dict[str, int],
    target_program: str,
    points_needed: int,
) -> Optional[Tuple[str, int, float]]:
    """
    Find the best source to transfer points from for a target airline program.
    Prioritizes: 1) Direct balance, 2) Best ratio, 3) Sufficient balance
    
    Args:
        available_points: User's point balances
        target_program: Target airline program code
        points_needed: Points required in target program
        
    Returns:
        Tuple of (source_program, points_to_transfer, ratio) or None
    """
    prog_upper = target_program.upper()
    
    # Check direct balance first
    direct = available_points.get(prog_upper, 0) + available_points.get(prog_upper.lower(), 0)
    if direct >= points_needed:
        return (prog_upper, points_needed, 1.0)
    
    # Find best bank transfer option
    best_option = None
    best_ratio = 0.0
    
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        if bank_lower not in EXTENDED_TRANSFER_GRAPH:
            continue
        
        if prog_upper in EXTENDED_TRANSFER_GRAPH[bank_lower]:
            ratio = EXTENDED_TRANSFER_GRAPH[bank_lower][prog_upper].get("ratio", 1.0)
            points_from_bank = int(balance * ratio)
            
            if points_from_bank >= points_needed and ratio > best_ratio:
                # Calculate how many bank points we need to transfer
                bank_points_needed = int(points_needed / ratio) if ratio > 0 else points_needed
                if bank_points_needed <= balance:
                    best_option = (bank_lower, bank_points_needed, ratio)
                    best_ratio = ratio
    
    return best_option


# =============================================================================
# CREDIT CARD RECOMMENDATIONS (FLIGHTS ONLY)
# =============================================================================

CREDIT_CARD_DETAILS: Dict[str, Dict[str, Any]] = {
    "chase": {
        "cards": [
            {"name": "Chase Sapphire Reserve", "annual_fee": 550, "earn_rate": "3x travel/dining", "best_for": "Premium travel"},
            {"name": "Chase Sapphire Preferred", "annual_fee": 95, "earn_rate": "2x travel/dining", "best_for": "Moderate travel"},
            {"name": "Chase Ink Business Preferred", "annual_fee": 95, "earn_rate": "3x travel/shipping", "best_for": "Business travel"},
        ],
        "best_transfers": ["UA", "BA", "VS", "AF"],
        "sweet_spots": [
            "Chase → United: No fuel surcharges, good availability",
            "Chase → Virgin Atlantic: Book Delta or Air France with low surcharges",
            "Chase → British Airways: Short-haul flights on AA and partners",
        ],
    },
    "amex": {
        "cards": [
            {"name": "Amex Platinum", "annual_fee": 695, "earn_rate": "5x flights", "best_for": "Premium travel"},
            {"name": "Amex Gold", "annual_fee": 250, "earn_rate": "4x dining/groceries", "best_for": "Dining rewards"},
            {"name": "Amex Business Platinum", "annual_fee": 695, "earn_rate": "5x flights", "best_for": "Business premium"},
        ],
        "best_transfers": ["DL", "NH", "VS", "SQ", "AV"],
        "sweet_spots": [
            "Amex → ANA: Excellent for Japan business class (75-95K RT)",
            "Amex → Virgin Atlantic: Book Delta domestically or Air France to Europe",
            "Amex → Avianca LifeMiles: Great Star Alliance redemptions, no fuel surcharges",
        ],
    },
    "citi": {
        "cards": [
            {"name": "Citi Premier", "annual_fee": 95, "earn_rate": "3x travel/dining", "best_for": "Balance transfer"},
            {"name": "Citi Custom Cash", "annual_fee": 0, "earn_rate": "5% top category", "best_for": "Flexible rewards"},
        ],
        "best_transfers": ["AA", "TK", "SQ", "QR", "CX"],
        "sweet_spots": [
            "Citi → Turkish: Book Star Alliance with lower fees",
            "Citi → Cathay: Great for Asia-Pacific travel",
            "Citi → American: Direct AA flights domestically",
        ],
    },
    "capitalone": {
        "cards": [
            {"name": "Capital One Venture X", "annual_fee": 395, "earn_rate": "2x everything", "best_for": "Simple rewards"},
            {"name": "Capital One Venture", "annual_fee": 95, "earn_rate": "2x everything", "best_for": "No FTF travel"},
        ],
        "best_transfers": ["AF", "EK", "TK", "AV", "BA"],
        "sweet_spots": [
            "Capital One → Air France: Good for Europe",
            "Capital One → Avianca: No fuel surcharges on Star Alliance",
            "Capital One → Emirates: Premium cabin to Dubai/Asia",
        ],
    },
    "bilt": {
        "cards": [
            {"name": "Bilt Mastercard", "annual_fee": 0, "earn_rate": "1x rent (no fee)", "best_for": "Rent rewards"},
        ],
        "best_transfers": ["UA", "AA", "VS"],
        "sweet_spots": [
            "Bilt → United/AA: Both domestic giants at 1:1",
            "Bilt → Virgin Atlantic: Sweet spots to Europe/Asia",
        ],
    },
}


def get_credit_card_recommendations(
    available_points: Dict[str, int],
    target_programs: List[str],
) -> List[Dict[str, Any]]:
    """
    Get credit card recommendations based on user's points and travel goals.
    
    Args:
        available_points: User's current point balances
        target_programs: Airline programs user wants to use
        
    Returns:
        List of card recommendations with reasons
    """
    recommendations = []
    
    for bank, balance in available_points.items():
        if balance <= 0:
            continue
        bank_lower = bank.lower()
        
        if bank_lower in CREDIT_CARD_DETAILS:
            details = CREDIT_CARD_DETAILS[bank_lower]
            
            # Check if any target programs are good transfers
            matching_transfers = [
                prog for prog in target_programs 
                if prog in details.get("best_transfers", [])
            ]
            
            if matching_transfers:
                recommendations.append({
                    "bank": bank_lower,
                    "balance": balance,
                    "cards": details["cards"],
                    "relevant_transfers": matching_transfers,
                    "sweet_spots": details["sweet_spots"],
                    "reason": f"You have {balance:,} points that transfer well to {', '.join(matching_transfers)}",
                })
    
    return recommendations


def get_transfer_timing_advice(
    bank: str,
    days_until_travel: int,
) -> Dict[str, Any]:
    """
    Get advice on transfer timing based on bank and travel date.
    
    Args:
        bank: Bank code
        days_until_travel: Days until departure
        
    Returns:
        Dict with timing advice and warnings
    """
    TRANSFER_TIMES = {
        "chase": {"typical_hours": 0, "display": "Instant", "safe_days": 0},
        "amex": {"typical_hours": 48, "display": "1-2 business days", "safe_days": 3},
        "citi": {"typical_hours": 24, "display": "Instant to 24 hours", "safe_days": 1},
        "capitalone": {"typical_hours": 48, "display": "Instant to 2 days", "safe_days": 3},
        "bilt": {"typical_hours": 0, "display": "Instant", "safe_days": 0},
    }
    
    bank_lower = bank.lower()
    timing = TRANSFER_TIMES.get(bank_lower, {"typical_hours": 72, "display": "Varies", "safe_days": 4})
    
    is_safe = days_until_travel >= timing["safe_days"]
    
    advice = {
        "transfer_time": timing["display"],
        "safe_days_needed": timing["safe_days"],
        "is_safe_to_transfer": is_safe,
        "recommendation": "",
        "warning": None,
    }
    
    if is_safe:
        advice["recommendation"] = f"Safe to transfer! {timing['display']} is sufficient for your {days_until_travel}-day timeline."
    else:
        advice["warning"] = (
            f"⚠️ Transfer may not complete in time! "
            f"{bank_lower.title()} transfers take {timing['display']}, "
            f"but you only have {days_until_travel} day(s) until travel."
        )
        advice["recommendation"] = (
            "Consider: (1) Booking with cash and transferring points later for refund, "
            "(2) Using a different bank with faster transfers, or "
            "(3) Waiting to book until transfers complete."
        )
    
    return advice


def generate_complete_transfer_plan(
    flight_awards: List[Dict[str, Any]],
    available_points: Dict[str, int],
    days_until_travel: int = 14,
) -> Dict[str, Any]:
    """
    Generate a complete transfer plan with step-by-step instructions for FLIGHTS ONLY.
    
    Args:
        flight_awards: List of flights to book with points
        available_points: User's point balances
        days_until_travel: Days until first flight
        
    Returns:
        Complete transfer plan with instructions, timing, and warnings
    """
    transfer_instructions = []
    booking_steps = []
    warnings = []
    total_out_of_pocket = 0.0
    
    # Consolidate transfer needs by (bank, program)
    transfer_needs: Dict[Tuple[str, str], int] = {}
    
    for award in flight_awards:
        program = award.get("program", "").upper()
        points_needed = award.get("points", 0)
        surcharge = award.get("surcharge", 0)
        
        total_out_of_pocket += surcharge
        
        # Find best transfer source
        source = get_best_transfer_source(available_points, program, points_needed)
        
        if source:
            src_program, src_points, ratio = source
            
            if src_program.lower() in EXTENDED_TRANSFER_GRAPH:
                # It's a bank transfer
                key = (src_program.lower(), program)
                transfer_needs[key] = transfer_needs.get(key, 0) + int(src_points)
    
    # Build transfer instructions
    step_num = 1
    for (bank, program), total_points in transfer_needs.items():
        instruction = build_transfer_instruction(bank, program, total_points)
        
        # Add timing advice
        timing = get_transfer_timing_advice(bank, days_until_travel)
        if timing.get("warning"):
            warnings.append(timing["warning"])
        
        transfer_instructions.append({
            "step": step_num,
            "instruction": instruction,
            "timing_advice": timing,
        })
        step_num += 1
    
    # Build booking steps
    for i, award in enumerate(flight_awards):
        booking_steps.append({
            "step": step_num + i,
            "type": "flight",
            "description": award.get("description", "Flight"),
            "points": award.get("points", 0),
            "surcharge": award.get("surcharge", 0),
            "program": award.get("program", ""),
            "booking_url": PROGRAM_METADATA.get(award.get("program", "").upper(), {}).get("booking_url", ""),
        })
    
    return {
        "transfer_instructions": transfer_instructions,
        "booking_steps": booking_steps,
        "total_out_of_pocket": total_out_of_pocket,
        "warnings": warnings,
        "credit_card_tips": get_credit_card_recommendations(
            available_points, 
            list(set([a.get("program", "").upper() for a in flight_awards]))
        ),
    }
