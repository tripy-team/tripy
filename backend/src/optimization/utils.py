"""
Utility functions for the optimization system.

This module contains helper functions for datetime parsing, cost calculations,
and other common operations.
"""

from datetime import datetime
from typing import Dict, Optional, Tuple, List, Set
import logging

from .models import EdgeKey, FlightEdge
from .constants import (
    OOP_CONFIG,
    CPP_CONFIG,
    HIGH_SURCHARGE_PROGRAMS,
    CPP_THRESHOLDS,
    DEFAULT_CPP_THRESHOLD,
    BANK_NAME_MAPPINGS,
    BANK_PREFIXES,
)


logger = logging.getLogger(__name__)


# =============================================================================
# DATETIME PARSING
# =============================================================================

# Reference point for datetime calculations
DATETIME_REFERENCE = datetime(2020, 1, 1)


def parse_datetime_to_minutes(datetime_str: Optional[str]) -> Optional[float]:
    """
    Parse a datetime string to minutes since reference point.
    
    Supports formats:
    - ISO format: "2026-02-17T14:30:00"
    - Space format: "2026-02-17 14:30:00" or "2026-02-17 14:30"
    
    Returns None if parsing fails.
    """
    if not datetime_str:
        return None
    
    try:
        # Try ISO format: "2026-02-17T14:30:00"
        if "T" in datetime_str:
            # Remove milliseconds if present
            cleaned = datetime_str.split(".")[0]
            parsed = datetime.strptime(cleaned, "%Y-%m-%dT%H:%M:%S")
        elif " " in datetime_str:
            # Try space format
            try:
                parsed = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                parsed = datetime.strptime(datetime_str, "%Y-%m-%d %H:%M")
        else:
            return None
        
        # Return minutes since reference point
        return (parsed - DATETIME_REFERENCE).total_seconds() / 60.0
    
    except (ValueError, AttributeError) as e:
        logger.debug(f"Failed to parse datetime '{datetime_str}': {e}")
        return None


def parse_edge_times(
    edges: List[EdgeKey],
    departure_time: Dict[EdgeKey, str],
    arrival_time: Dict[EdgeKey, str],
) -> Tuple[Dict[EdgeKey, float], Dict[EdgeKey, float]]:
    """
    Parse departure and arrival times for all edges.
    
    Returns:
        Tuple of (departure_minutes, arrival_minutes) dictionaries
    """
    dep_minutes = {}
    arr_minutes = {}
    
    for e in edges:
        dep = parse_datetime_to_minutes(departure_time.get(e))
        arr = parse_datetime_to_minutes(arrival_time.get(e))
        
        if dep is not None:
            dep_minutes[e] = dep
        if arr is not None:
            arr_minutes[e] = arr
    
    logger.info(
        f"Parsed edge times: {len(dep_minutes)} departures, "
        f"{len(arr_minutes)} arrivals out of {len(edges)} edges"
    )
    
    return dep_minutes, arr_minutes


# =============================================================================
# COST CALCULATIONS
# =============================================================================

def calculate_cpp(cash_cost: float, surcharge: float, points_cost: int) -> float:
    """
    Calculate cents-per-point value for an award redemption.
    
    CPP = (cash_saved * 100) / points_required
    
    Returns 0.0 if calculation is invalid.
    """
    if points_cost <= 0:
        return 0.0
    
    cash_saved = cash_cost - surcharge
    if cash_saved <= 0:
        return 0.0
    
    return (cash_saved * 100.0) / points_cost


def should_reject_award(
    cash_cost: float,
    surcharge: float,
    max_ratio: float = OOP_CONFIG.MAX_SURCHARGE_RATIO,
    max_absolute: float = OOP_CONFIG.MAX_SURCHARGE_ABSOLUTE,
) -> bool:
    """
    Check if an award should be rejected due to excessive surcharges.
    
    Returns True if:
    - Surcharge > max_absolute (default $300)
    - Surcharge > max_ratio * cash_cost (default 50%)
    """
    if surcharge > max_absolute:
        return True
    if cash_cost > 0 and surcharge > cash_cost * max_ratio:
        return True
    return False


def calculate_surcharge_penalty(
    airline: str,
    surcharge: float,
    threshold: float = OOP_CONFIG.SURCHARGE_PENALTY_THRESHOLD,
    weight: float = OOP_CONFIG.SURCHARGE_PENALTY_WEIGHT,
) -> float:
    """
    Calculate penalty for high surcharges in OOP mode.
    
    Returns 0 if surcharge <= threshold, otherwise returns weighted penalty.
    Extra penalty applied for high-surcharge programs.
    """
    if surcharge <= threshold:
        return 0.0
    
    base_penalty = (surcharge - threshold) * weight
    
    # Extra penalty for high-surcharge programs
    if airline.upper() in HIGH_SURCHARGE_PROGRAMS:
        base_penalty *= OOP_CONFIG.HIGH_SURCHARGE_PROGRAM_MULTIPLIER
    
    return base_penalty


def get_cpp_threshold(airline: str) -> float:
    """Get CPP threshold for a specific airline program."""
    return CPP_THRESHOLDS.get(airline.upper(), DEFAULT_CPP_THRESHOLD)


# =============================================================================
# POINTS PROCESSING
# =============================================================================

def normalize_bank_key(key: str) -> str:
    """
    Normalize a bank key to match the transfer graph format.
    
    Examples:
        'amex_membership_rewards' -> 'amex'
        'Chase Ultimate Rewards' -> 'chase'
        'Citi ThankYou Points' -> 'citi'
    """
    k_lower = key.lower().replace(" ", "_")
    
    # Direct mapping
    if k_lower in BANK_NAME_MAPPINGS:
        return BANK_NAME_MAPPINGS[k_lower]
    
    # Check prefixes
    for prefix in BANK_PREFIXES:
        if k_lower.startswith(prefix):
            return prefix
    
    return k_lower


def is_bank_key(key: str, transfer_graph: Optional[Dict] = None) -> bool:
    """
    Check if a key represents a bank/credit card program (transferable points).
    
    Handles both short keys (e.g., 'amex', 'chase') and long keys 
    (e.g., 'amex_membership_rewards', 'chase_ultimate_rewards').
    """
    if not isinstance(key, str):
        return False
    
    k_lower = key.lower()
    
    # Direct match in transfer_graph
    if transfer_graph and k_lower in transfer_graph:
        return True
    
    # Check if key matches any bank name mapping
    k_normalized = k_lower.replace(" ", "_")
    if k_normalized in BANK_NAME_MAPPINGS:
        return True
    
    # Check prefixes
    for prefix in BANK_PREFIXES:
        if k_lower.startswith(prefix):
            return True
    
    return False


def normalize_airline_code(key: str) -> str:
    """Normalize airline code to uppercase."""
    return str(key or "").strip().upper()


def split_balances(
    user_points: Dict[str, float],
    transfer_graph: Optional[Dict] = None,
) -> Tuple[Dict[str, float], Dict[str, float]]:
    """
    Split user points into bank (transferable) and airline (native) balances.
    
    Bank points (e.g., amex_membership_rewards) can be transferred to airlines.
    Airline points (e.g., AA, UA) are used directly.
    
    Returns:
        Tuple of (bank_balances, airline_balances)
    """
    banks = {}
    airlines = {}
    
    for key, value in (user_points or {}).items():
        balance = float(value or 0)
        if balance <= 0:
            continue
        
        if is_bank_key(key, transfer_graph):
            # Normalize bank key and accumulate
            normalized = normalize_bank_key(key)
            banks[normalized] = banks.get(normalized, 0.0) + balance
        else:
            # Treat as airline code
            airline_code = normalize_airline_code(key)
            if airline_code:
                airlines[airline_code] = airlines.get(airline_code, 0.0) + balance
    
    return banks, airlines


# =============================================================================
# GRAPH UTILITIES
# =============================================================================

def build_edge_graph_stats(edges: List[EdgeKey]) -> Dict[Tuple[str, str], int]:
    """
    Build statistics about edges in the graph.
    
    Returns dict of (origin, destination) -> count
    """
    stats = {}
    for origin, dest, _ in edges:
        key = (origin, dest)
        stats[key] = stats.get(key, 0) + 1
    return stats


def validate_graph_connectivity(
    edges: List[EdgeKey],
    cities: List[str],
    start_cities: List[str],
    end_cities: List[str],
    must_visit: List[str],
) -> List[str]:
    """
    Validate that the graph has basic connectivity.
    
    Returns list of warning messages (empty if all OK).
    """
    warnings = []
    
    # Build adjacency info
    has_outgoing = {c: False for c in cities}
    has_incoming = {c: False for c in cities}
    
    for origin, dest, _ in edges:
        has_outgoing[origin] = True
        has_incoming[dest] = True
    
    # Check start cities
    for start in start_cities:
        if start and not has_outgoing.get(start, False):
            warnings.append(f"No outgoing edges from start city {start}")
    
    # Check end cities
    for end in end_cities:
        if end and not has_incoming.get(end, False):
            warnings.append(f"No incoming edges to end city {end}")
    
    # Check must-visit cities
    for city in must_visit:
        if not has_incoming.get(city, False):
            warnings.append(f"No incoming edges to must-visit city {city}")
        if not has_outgoing.get(city, False):
            warnings.append(f"No outgoing edges from must-visit city {city}")
    
    return warnings


# =============================================================================
# SOLUTION FORMATTING
# =============================================================================

def format_currency(amount: float) -> str:
    """Format a dollar amount."""
    return f"${amount:,.2f}"


def format_points(points: int) -> str:
    """Format a points amount."""
    return f"{points:,}"


def format_cpp(cpp: float) -> str:
    """Format a CPP value."""
    return f"{cpp:.2f}¢"


def build_transfer_summary_text(
    bank: str,
    airline: str,
    points: int,
    miles: int,
    ratio: str,
) -> str:
    """Build human-readable transfer summary."""
    return (
        f"Transfer {format_points(points)} points from {bank} to {airline} "
        f"→ receive {format_points(miles)} miles (ratio: {ratio})"
    )
