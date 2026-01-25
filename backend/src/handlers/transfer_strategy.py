"""
Transfer Strategy Module

Extended transfer graph supporting both airline and hotel programs.
Provides utilities for computing optimal point transfers to minimize out-of-pocket costs.
"""

from typing import Dict, List, Optional, Set, Tuple, Any
from dataclasses import dataclass, field


# =============================================================================
# EXTENDED TRANSFER GRAPH (Banks → Airlines + Hotels)
# =============================================================================

EXTENDED_TRANSFER_GRAPH: Dict[str, Dict[str, Dict[str, Any]]] = {
    "amex": {
        # Airlines (Membership Rewards)
        "DL": {"ratio": 1.0, "type": "airline", "name": "Delta SkyMiles"},
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "BA": {"ratio": 1.0, "type": "airline", "name": "British Airways Avios"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "NH": {"ratio": 1.0, "type": "airline", "name": "ANA Mileage Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "IB": {"ratio": 1.0, "type": "airline", "name": "Iberia Plus"},
        # Hotels
        "HH": {"ratio": 2.0, "type": "hotel", "name": "Hilton Honors"},  # 1 MR = 2 Hilton
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
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
        "WN": {"ratio": 1.0, "type": "airline", "name": "Southwest Rapid Rewards"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
    },
    "citi": {
        # Airlines (ThankYou Points)
        "B6": {"ratio": 1.0, "type": "airline", "name": "JetBlue TrueBlue"},
        "SQ": {"ratio": 1.0, "type": "airline", "name": "Singapore KrisFlyer"},
        "CX": {"ratio": 1.0, "type": "airline", "name": "Cathay Pacific Asia Miles"},
        "QR": {"ratio": 1.0, "type": "airline", "name": "Qatar Airways Privilege Club"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "EY": {"ratio": 1.0, "type": "airline", "name": "Etihad Guest"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "AV": {"ratio": 1.0, "type": "airline", "name": "Avianca LifeMiles"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "QF": {"ratio": 1.0, "type": "airline", "name": "Qantas Frequent Flyer"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        # Hotels
        "ACC": {"ratio": 2.0, "type": "hotel", "name": "Accor Live Limitless"},
        "WYNDHAM": {"ratio": 1.0, "type": "hotel", "name": "Wyndham Rewards"},
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
        "TAP": {"ratio": 1.0, "type": "airline", "name": "TAP Miles&Go"},
        # Hotels
        "ACC": {"ratio": 1.0, "type": "hotel", "name": "Accor Live Limitless"},
        "WYNDHAM": {"ratio": 1.0, "type": "hotel", "name": "Wyndham Rewards"},
    },
    "bilt": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline", "name": "United MileagePlus"},
        "AA": {"ratio": 1.0, "type": "airline", "name": "American AAdvantage"},
        "AF": {"ratio": 1.0, "type": "airline", "name": "Air France / KLM Flying Blue"},
        "TK": {"ratio": 1.0, "type": "airline", "name": "Turkish Miles&Smiles"},
        "EK": {"ratio": 1.0, "type": "airline", "name": "Emirates Skywards"},
        "VS": {"ratio": 1.0, "type": "airline", "name": "Virgin Atlantic Flying Club"},
        "EI": {"ratio": 1.0, "type": "airline", "name": "Aer Lingus AerClub"},
        "AC": {"ratio": 1.0, "type": "airline", "name": "Air Canada Aeroplan"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel", "name": "World of Hyatt"},
        "IHG": {"ratio": 1.0, "type": "hotel", "name": "IHG One Rewards"},
        "MAR": {"ratio": 1.0, "type": "hotel", "name": "Marriott Bonvoy"},
    },
}

# Legacy transfer graph for backward compatibility (airlines only, simple ratio)
DEFAULT_TRANSFER_GRAPH: Dict[str, Dict[str, float]] = {
    bank: {prog: info["ratio"] for prog, info in programs.items() if info["type"] == "airline"}
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
}

PROGRAM_METADATA: Dict[str, Dict[str, Any]] = {
    # Airlines
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
    # Hotels
    "HH": {"name": "Hilton Honors", "type": "hotel", "booking_url": "https://www.hilton.com"},
    "MAR": {"name": "Marriott Bonvoy", "type": "hotel", "booking_url": "https://www.marriott.com"},
    "HYATT": {"name": "World of Hyatt", "type": "hotel", "booking_url": "https://www.hyatt.com"},
    "IHG": {"name": "IHG One Rewards", "type": "hotel", "booking_url": "https://www.ihg.com"},
    "ACC": {"name": "Accor Live Limitless", "type": "hotel", "booking_url": "https://all.accor.com"},
    "WYNDHAM": {"name": "Wyndham Rewards", "type": "hotel", "booking_url": "https://www.wyndhamhotels.com"},
}


# =============================================================================
# DATA CLASSES
# =============================================================================

@dataclass
class TransferOption:
    """Represents a possible transfer from a bank to a program."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    program_type: str  # "airline" or "hotel"
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
    transfer_ratio: str  # e.g., "1:1" or "1:2"
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
    """Get the display name for a program (airline or hotel)."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("name", program)


def get_program_type(program: str) -> Optional[str]:
    """Get the type of a program ('airline' or 'hotel')."""
    return PROGRAM_METADATA.get(program.upper(), {}).get("type")


def can_transfer(bank: str, program: str) -> bool:
    """Check if a bank can transfer to a specific program."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    return prog_upper in EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})


def get_transfer_ratio(bank: str, program: str) -> float:
    """Get the transfer ratio from bank to program (points received per bank point)."""
    bank_lower = bank.lower()
    prog_upper = program.upper()
    info = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {}).get(prog_upper, {})
    return info.get("ratio", 0.0)


def get_transfer_partners(bank: str, program_type: Optional[str] = None) -> List[str]:
    """
    Get all programs a bank can transfer to.
    
    Args:
        bank: Bank code (e.g., "amex", "chase")
        program_type: Optional filter for "airline" or "hotel"
    
    Returns:
        List of program codes
    """
    bank_lower = bank.lower()
    programs = EXTENDED_TRANSFER_GRAPH.get(bank_lower, {})
    
    if program_type:
        return [prog for prog, info in programs.items() if info.get("type") == program_type]
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
                program_type=info.get("type", "airline"),
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
        program: Target program code
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
        steps.append(f"8. Book at {booking_url} using your {prog_name} points")
    
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
    Compute the effective points balance for a target program,
    including transferable bank points.
    
    Args:
        available_points: User's point balances
        target_program: Target program code
        
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
    Find the best source to transfer points from for a target program.
    Prioritizes: 1) Direct balance, 2) Best ratio, 3) Sufficient balance
    
    Args:
        available_points: User's point balances
        target_program: Target program code
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
