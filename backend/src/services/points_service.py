from __future__ import annotations

import logging
from typing import Dict, Any, List, Tuple, Optional

from src.repos import points_repo
from src.utils.normalize import normalize_program_name
from src.utils.display_formatters import format_currency, format_points, format_cents_per_point

# Centralized program config (single source of truth)
from src.config.programs import (
    BANK_PROGRAMS,
    AIRLINE_PROGRAMS_SET as AIRLINE_PROGRAMS,
    HOTEL_PROGRAMS_SET as HOTEL_PROGRAMS,
    TRANSFER_PARTNERS,
    PROGRAM_DISPLAY_NAMES,
)

logger = logging.getLogger(__name__)

try:
    from src.handlers.tpg_valuations import (
        fetch_tpg_valuations,
        get_cents_per_point,
        get_valuations,
    )
except ImportError:
    try:
        from ..handlers.tpg_valuations import (
            fetch_tpg_valuations,
            get_cents_per_point,
            get_valuations,
        )
    except ImportError:
        fetch_tpg_valuations = None  # type: ignore
        get_cents_per_point = None  # type: ignore
        get_valuations = None  # type: ignore


def _get_program_category(program: str) -> str:
    """Categorize a program as bank, airline, or hotel."""
    prog_lower = program.lower()
    if prog_lower in BANK_PROGRAMS:
        return "bank"
    prog_upper = program.upper()
    if prog_upper in AIRLINE_PROGRAMS or len(prog_upper) == 2:
        return "airline"
    if prog_upper in HOTEL_PROGRAMS:
        return "hotel"
    return "unknown"


def _get_program_display_name(program: str) -> str:
    """Get human-readable program name."""
    return PROGRAM_DISPLAY_NAMES.get(program, PROGRAM_DISPLAY_NAMES.get(program.lower(), program))


def _get_transfer_partners(program: str) -> List[str]:
    """Get transfer partner codes for a bank program."""
    return TRANSFER_PARTNERS.get(program.lower(), [])


def upsert_points(
    trip_id: str, user_id: str, program: str, balance: int
) -> Dict[str, Any]:
    prog = normalize_program_name(program)
    user_program = f"{user_id}#{prog}"
    item = {
        "tripId": trip_id,
        "userProgram": user_program,
        "userId": user_id,
        "program": prog,
        "balance": balance,
        "source": "manual",
    }
    points_repo.upsert_points(trip_id, user_program, item)
    return item


def _enrich_with_valuations(
    items: List[Dict[str, Any]], tpg_vals: Dict[str, float]
) -> Tuple[List[Dict[str, Any]], float]:
    """Add value, centsPerPoint, and display fields to each item. Returns (enriched_items, total_value)."""
    total_value = 0.0
    out: List[Dict[str, Any]] = []
    for x in items:
        row = dict(x)
        bal = int(x.get("balance") or 0)
        prog = (x.get("program") or "").strip() or None
        cpp = get_cents_per_point(prog, tpg_vals) if prog else None
        
        # Basic valuations
        if cpp is not None:
            row["centsPerPoint"] = round(cpp, 2)
            v = bal * cpp / 100.0
            row["value"] = round(v, 2)
            total_value += v
        else:
            row["centsPerPoint"] = None
            row["value"] = None
        
        # Display fields
        row["displayBalance"] = format_points(bal)
        row["displayValue"] = format_currency(row.get("value")) if row.get("value") else "—"
        row["displayCPP"] = format_cents_per_point(cpp) if cpp else "—"
        
        # Program metadata
        if prog:
            row["programDisplayName"] = _get_program_display_name(prog)
            row["category"] = _get_program_category(prog)
            row["transferPartners"] = _get_transfer_partners(prog) if row["category"] == "bank" else []
        
        out.append(row)
    return out, round(total_value, 2)


def _build_transfer_recommendations(
    items: List[Dict[str, Any]],
    destinations: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    """
    Build transfer recommendations based on user's points and destinations.
    Returns list of {fromProgram, toProgram, reason, potentialSavings, displaySavings}.
    """
    recommendations = []
    
    # Group bank points
    bank_programs = [
        item for item in items
        if _get_program_category(item.get("program", "")) == "bank"
        and item.get("balance", 0) > 10000  # Only recommend if meaningful balance
    ]
    
    # Common high-value transfer partners
    high_value_partners = [
        ("chase", "UA", "United offers excellent availability on Star Alliance"),
        ("chase", "BA", "British Airways is great for short-haul flights"),
        ("amex", "DL", "Delta has good domestic coverage"),
        ("amex", "ANA", "ANA is excellent for Asia-Pacific flights"),
        ("citi", "AA", "American has extensive domestic network"),
        ("bilt", "UA", "United is a versatile transfer partner"),
    ]
    
    for bank_item in bank_programs:
        prog = bank_item.get("program", "").lower()
        balance = bank_item.get("balance", 0)
        
        # Find matching recommendations
        for bank, airline, reason in high_value_partners:
            if prog == bank:
                partners = _get_transfer_partners(prog)
                if airline in partners or airline.upper() in partners:
                    # Estimate savings (rough calculation)
                    estimated_cpp = 1.8  # Average CPP for awards
                    potential_savings = int(balance * estimated_cpp / 100)
                    
                    recommendations.append({
                        "fromProgram": _get_program_display_name(prog),
                        "fromProgramCode": prog,
                        "toProgram": _get_program_display_name(airline),
                        "toProgramCode": airline,
                        "reason": reason,
                        "potentialSavings": potential_savings,
                        "displaySavings": format_currency(potential_savings),
                    })
    
    # Limit to top 3 recommendations
    return recommendations[:3]


def trip_points_summary(trip_id: str) -> Dict[str, Any]:
    """
    Get points summary for a trip with display fields and recommendations.
    
    Returns:
    {
        "tripId": str,
        "totalPoints": int,
        "displayTotalPoints": str,
        "totalValue": float,
        "displayTotalValue": str,
        "items": [...],  # Enriched with display fields
        "byCategory": {
            "bank": [...],
            "airline": [...],
            "hotel": [...],
        },
        "recommendations": [...],
    }
    """
    items = points_repo.list_points_for_trip(trip_id)
    total = sum(int(x.get("balance", 0)) for x in items)

    try:
        if fetch_tpg_valuations and get_cents_per_point:
            tpg_vals = fetch_tpg_valuations()
            enriched, total_value = _enrich_with_valuations(items, tpg_vals)
        else:
            enriched = [{**x, "value": None, "centsPerPoint": None} for x in items]
            total_value = 0.0
    except Exception as e:
        logger.warning(f"Error fetching TPG valuations: {e}")
        enriched = [
            {**x, "value": None, "centsPerPoint": None}
            for x in items
        ]
        total_value = 0.0

    # Group by category
    by_category = {
        "bank": [x for x in enriched if x.get("category") == "bank"],
        "airline": [x for x in enriched if x.get("category") == "airline"],
        "hotel": [x for x in enriched if x.get("category") == "hotel"],
    }
    
    # Build recommendations
    recommendations = _build_transfer_recommendations(enriched)

    return {
        "tripId": trip_id,
        "totalPoints": total,
        "displayTotalPoints": format_points(total),
        "totalValue": total_value,
        "displayTotalValue": format_currency(total_value),
        "items": enriched,
        "byCategory": by_category,
        "recommendations": recommendations,
    }
