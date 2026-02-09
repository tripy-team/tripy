"""
Centralized configuration for the agentic optimization system.
OOP (Out Of Pocket) is the primary optimization strategy.
"""

from typing import Literal

# =============================================================================
# DEFAULT OPTIMIZATION MODE
# =============================================================================

DEFAULT_OPTIMIZATION_MODE: Literal["oop", "cpp"] = "oop"

# =============================================================================
# OOP MODE CONFIGURATION
# =============================================================================

OOP_CONFIG = {
    # Minimum CPP threshold - use points if value >= 0.5¢
    "min_cpp_threshold": 0.5,
    
    # Weight priorities (higher = more important)
    "weights": {
        "points_savings": 10**7,    # Highest priority: maximize points usage
        "cash_minimization": 10**6,  # Second: minimize cash
        "surcharge_penalty": 10**3,  # Third: avoid high surcharges
        "travel_time": 1.0,          # Lowest: optimize travel time
    },
    
    # Surcharge thresholds
    "max_surcharge_ratio": 0.50,     # Reject if surcharge > 50% of cash price
    "surcharge_penalty_start": 0.20, # Start penalizing at 20%
}

# =============================================================================
# CPP MODE CONFIGURATION (secondary, for comparison)
# =============================================================================

CPP_CONFIG = {
    "min_cpp_threshold": 1.0,  # Default minimum
    "program_thresholds": {
        # Premium programs
        "SQ": 1.5, "NH": 1.5, "JL": 1.4, "VS": 1.3, "CX": 1.3,
        # High-surcharge programs
        "BA": 1.8, "LH": 1.6, "LX": 1.6,
        # US Domestic
        "UA": 1.0, "AA": 1.0, "DL": 1.0, "B6": 0.9,
    },
    "weights": {
        "points_value": 10**6,
        "cash_cost": 10**3,
        "travel_time": 1.0,
        "card_benefits": 10**4,
    },
}

# =============================================================================
# TRANSFER GRAPH
# =============================================================================

TRANSFER_GRAPH = {
    "Chase UR": {
        "airlines": ["UA", "AA", "BA", "AF", "VS", "SQ", "IB", "AV", "EK", "AC"],
        "hotels": ["HYATT", "MAR", "IHG"],
        "ratios": {
            "UA": 1.0, "AA": 1.0, "BA": 1.0, "AF": 1.0, "VS": 1.0,
            "SQ": 1.0, "IB": 1.0, "AV": 1.0, "EK": 1.0, "AC": 1.0,
            "HYATT": 1.0, "MAR": 1.0, "IHG": 1.0,
        },
        "transfer_times": {
            "UA": "Instant", "AA": "Instant", "BA": "Instant", "AF": "Instant",
            "VS": "Instant", "SQ": "Instant", "EK": "Instant", "AC": "Instant",
            "HYATT": "Instant", "MAR": "1-2 days",
        },
        "portal_url": "https://ultimaterewardspoints.chase.com",
    },
    "Amex MR": {
        "airlines": ["DL", "BA", "AF", "ANA", "VS", "SQ", "EK", "JL", "QR", "AV", "EY", "NH", "AC"],
        "hotels": ["HH", "MAR"],
        "ratios": {
            "DL": 1.0, "BA": 1.0, "AF": 1.0, "ANA": 1.0, "VS": 1.0,
            "SQ": 1.0, "EK": 1.0, "JL": 1.0, "QR": 1.0, "AV": 1.0,
            "EY": 1.0, "NH": 1.0, "AC": 1.0,
            "HH": 2.0, "MAR": 1.0,  # 1 MR = 2 Hilton
        },
        "transfer_times": {
            "DL": "Instant", "BA": "Instant", "AF": "Instant",
            "QR": "Instant", "AV": "Instant", "EY": "1-2 days",
            "HH": "Instant", "MAR": "1-2 days",
        },
        "portal_url": "https://global.americanexpress.com/rewards",
    },
    "Citi TYP": {
        "airlines": ["AA", "SQ", "TK", "VS", "AF", "EK", "QF", "AC", "JL", "CX", "EY", "QR"],
        "hotels": [],
        "ratios": {
            "AA": 1.0, "SQ": 1.0, "TK": 1.0, "VS": 1.0, "AF": 1.0,
            "EK": 1.0, "QF": 1.0, "AC": 1.0, "JL": 1.0, "CX": 1.0,
            "EY": 1.0, "QR": 1.0,
        },
        "transfer_times": {"AA": "Instant", "SQ": "1-2 days", "TK": "1-2 days", "AC": "Instant"},
        "portal_url": "https://www.thankyou.com",
    },
    "Capital One": {
        "airlines": ["AF", "BA", "TK", "AV", "QF", "TP"],
        "hotels": [],
        "ratios": {
            "AF": 1.0, "BA": 1.0, "TK": 1.0, "AV": 1.0, "QF": 1.0, "TP": 1.0,
        },
        "transfer_times": {"AF": "Instant", "BA": "Instant"},
        "portal_url": "https://www.capitalone.com/credit-cards/rewards",
    },
    "Bilt": {
        "airlines": ["AA", "UA", "AF", "TK", "VS", "IB", "AV"],
        "hotels": ["HYATT", "IHG"],
        "ratios": {
            "AA": 1.0, "UA": 1.0, "AF": 1.0, "TK": 1.0, "VS": 1.0,
            "IB": 1.0, "AV": 1.0, "HYATT": 1.0, "IHG": 1.0,
        },
        "transfer_times": {"AA": "Instant", "UA": "Instant", "HYATT": "Instant"},
        "portal_url": "https://www.biltrewards.com",
    },
}

# =============================================================================
# AIRLINE PROGRAMS
# =============================================================================

AIRLINE_PROGRAMS = {
    "UA": {"name": "United MileagePlus", "alliance": "Star Alliance"},
    "AA": {"name": "American AAdvantage", "alliance": "oneworld"},
    "DL": {"name": "Delta SkyMiles", "alliance": "SkyTeam"},
    "BA": {"name": "British Airways Avios", "alliance": "oneworld", "high_surcharge": True},
    "AF": {"name": "Air France Flying Blue", "alliance": "SkyTeam"},
    "VS": {"name": "Virgin Atlantic Flying Club", "alliance": "SkyTeam"},
    "SQ": {"name": "Singapore KrisFlyer", "alliance": "Star Alliance"},
    "NH": {"name": "ANA Mileage Club", "alliance": "Star Alliance"},
    "JL": {"name": "JAL Mileage Bank", "alliance": "oneworld"},
    "CX": {"name": "Cathay Pacific Asia Miles", "alliance": "oneworld"},
    "EK": {"name": "Emirates Skywards", "alliance": None},
    "QR": {"name": "Qatar Airways Privilege Club", "alliance": "oneworld"},
    "TK": {"name": "Turkish Miles&Smiles", "alliance": "Star Alliance"},
    "LH": {"name": "Lufthansa Miles & More", "alliance": "Star Alliance", "high_surcharge": True},
}

# =============================================================================
# HOTEL PROGRAMS
# =============================================================================

HOTEL_PROGRAMS = {
    "HH": {
        "name": "Hilton Honors",
        "typical_cpp": 0.5,
        "transfer_partners": ["Amex MR"],
    },
    "MAR": {
        "name": "Marriott Bonvoy",
        "typical_cpp": 0.8,
        "transfer_partners": ["Chase UR", "Amex MR"],
    },
    "HYATT": {
        "name": "World of Hyatt",
        "typical_cpp": 1.8,
        "transfer_partners": ["Chase UR", "Bilt"],
    },
    "IHG": {
        "name": "IHG One Rewards",
        "typical_cpp": 0.5,
        "transfer_partners": ["Chase UR", "Bilt"],
    },
}

# =============================================================================
# CABIN CLASSES
# =============================================================================

CABIN_CLASSES = {
    "Economy": {"serpapi_code": 1, "typical_cpp_range": (0.8, 1.5)},
    "Premium Economy": {"serpapi_code": 2, "typical_cpp_range": (1.0, 2.0)},
    "Business": {"serpapi_code": 3, "typical_cpp_range": (1.5, 3.0)},
    "First": {"serpapi_code": 4, "typical_cpp_range": (2.0, 5.0)},
}

# =============================================================================
# HELPER FUNCTIONS
# =============================================================================

def get_optimization_config(mode: str = None) -> dict:
    """Get configuration for the specified optimization mode."""
    mode = mode or DEFAULT_OPTIMIZATION_MODE
    return OOP_CONFIG if mode == "oop" else CPP_CONFIG


def _normalize_bank_for_transfer_graph(bank_key: str) -> str | None:
    """
    Normalize a bank key to match TRANSFER_GRAPH format.
    
    Handles mismatches like "amex_mr" -> "Amex MR".
    """
    if bank_key in TRANSFER_GRAPH:
        return bank_key
    
    bank_normalized = bank_key.lower().replace(" ", "_").replace("-", "_")
    
    for graph_bank in TRANSFER_GRAPH.keys():
        graph_normalized = graph_bank.lower().replace(" ", "_")
        if (bank_normalized == graph_normalized or 
            bank_normalized.replace("_", "") == graph_normalized.replace("_", "") or
            bank_normalized.split("_")[0] == graph_normalized.split("_")[0]):
            return graph_bank
    
    return None


def get_transfer_path(source_program: str, target_program: str) -> dict | None:
    """Get transfer path from bank points to airline/hotel program."""
    # Normalize source program to match TRANSFER_GRAPH
    normalized_source = _normalize_bank_for_transfer_graph(source_program)
    if not normalized_source:
        return None
    
    source = TRANSFER_GRAPH[normalized_source]
    all_targets = source.get("airlines", []) + source.get("hotels", [])
    
    if target_program not in all_targets:
        return None
    
    return {
        "source": normalized_source,
        "target": target_program,
        "ratio": source["ratios"].get(target_program, 1.0),
        "transfer_time": source["transfer_times"].get(target_program, "1-2 days"),
        "portal_url": source["portal_url"],
    }


def get_available_transfers_for_user(user_points: dict) -> list[dict]:
    """Get all available transfer paths for a user's points."""
    transfers = []
    
    for program, balance in user_points.items():
        # Normalize program key to match TRANSFER_GRAPH
        normalized_program = _normalize_bank_for_transfer_graph(program)
        if not normalized_program:
            continue
        
        source = TRANSFER_GRAPH[normalized_program]
        for airline in source.get("airlines", []):
            transfers.append({
                "source": program,  # Keep original key for user reference
                "target": airline,
                "balance": balance,
                "ratio": source["ratios"].get(airline, 1.0),
                "effective_miles": int(balance * source["ratios"].get(airline, 1.0)),
            })
        
        for hotel in source.get("hotels", []):
            transfers.append({
                "source": program,  # Keep original key for user reference
                "target": hotel,
                "balance": balance,
                "ratio": source["ratios"].get(hotel, 1.0),
                "effective_points": int(balance * source["ratios"].get(hotel, 1.0)),
            })
    
    return transfers
