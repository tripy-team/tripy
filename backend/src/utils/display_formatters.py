"""
Display formatters for frontend-intuitive API responses.
Provides pre-formatted display strings for common data types.
"""
from datetime import datetime
from typing import Dict, Any, List, Optional, Tuple


def format_currency(amount: Optional[float], currency: str = "USD") -> str:
    """Format a number as currency string."""
    if amount is None:
        return "—"
    if amount == 0:
        return "$0"
    if amount < 0:
        return f"-${abs(amount):,.0f}"
    return f"${amount:,.0f}"


def format_points(points: Optional[int]) -> str:
    """Format points with k suffix for large numbers."""
    if points is None:
        return "—"
    if points >= 1000:
        if points % 1000 == 0:
            return f"{points // 1000}k"
        return f"{points / 1000:.1f}k"
    return f"{points:,}"


def format_duration_minutes(minutes: Optional[int]) -> str:
    """Format duration in minutes to human-readable string."""
    if minutes is None or minutes <= 0:
        return "—"
    hours = minutes // 60
    mins = minutes % 60
    if hours == 0:
        return f"{mins}m"
    if mins == 0:
        return f"{hours}h"
    return f"{hours}h {mins:02d}m"


def format_date_range(start_date: Optional[str], end_date: Optional[str]) -> str:
    """Format date range as 'Mar 10 - 18, 2025' or similar."""
    if not start_date or not end_date:
        return "Dates flexible"
    
    try:
        start = datetime.strptime(start_date.strip(), "%Y-%m-%d")
        end = datetime.strptime(end_date.strip(), "%Y-%m-%d")
        
        # Same month
        if start.year == end.year and start.month == end.month:
            return f"{start.strftime('%b %d')} - {end.strftime('%d, %Y')}"
        # Same year
        if start.year == end.year:
            return f"{start.strftime('%b %d')} - {end.strftime('%b %d, %Y')}"
        # Different years
        return f"{start.strftime('%b %d, %Y')} - {end.strftime('%b %d, %Y')}"
    except (ValueError, AttributeError):
        return f"{start_date} - {end_date}"


def format_percentage(value: Optional[float], decimal_places: int = 0) -> str:
    """Format a decimal as percentage string."""
    if value is None:
        return "—"
    return f"{value * 100:.{decimal_places}f}%"


def format_cents_per_point(cpp: Optional[float]) -> str:
    """Format cents per point value."""
    if cpp is None or cpp <= 0:
        return "—"
    if cpp >= 1:
        return f"{cpp:.2f}¢/pt"
    return f"{cpp:.3f}¢/pt"


def calculate_savings_breakdown(
    all_cash_cost: float,
    out_of_pocket: float,
) -> Dict[str, Any]:
    """Calculate savings metrics with display strings."""
    cash_saved = max(0, all_cash_cost - out_of_pocket)
    savings_pct = cash_saved / all_cash_cost if all_cash_cost > 0 else 0
    
    return {
        "allCashCost": all_cash_cost,
        "displayAllCashCost": format_currency(all_cash_cost),
        "outOfPocket": out_of_pocket,
        "displayOutOfPocket": format_currency(out_of_pocket),
        "cashSaved": cash_saved,
        "displayCashSaved": format_currency(cash_saved),
        "savingsPercentage": savings_pct,
        "displaySavingsPercentage": format_percentage(savings_pct),
    }


def format_transport_mode(mode: str) -> Dict[str, str]:
    """Get transport mode display info (icon, label, colors)."""
    modes = {
        "flight": {
            "mode": "flight",
            "modeIcon": "✈️",
            "modeLabel": "Flight",
            "color": "blue",
        },
        "train": {
            "mode": "train",
            "modeIcon": "🚄",
            "modeLabel": "Train",
            "color": "green",
        },
        "bus": {
            "mode": "bus",
            "modeIcon": "🚌",
            "modeLabel": "Bus",
            "color": "orange",
        },
        "car": {
            "mode": "car",
            "modeIcon": "🚗",
            "modeLabel": "Car",
            "color": "purple",
        },
        "ferry": {
            "mode": "ferry",
            "modeIcon": "⛴️",
            "modeLabel": "Ferry",
            "color": "cyan",
        },
    }
    return modes.get(mode.lower(), modes["flight"])


def enrich_segment_with_display(segment: Dict[str, Any]) -> Dict[str, Any]:
    """Add display fields to a transport segment."""
    enriched = dict(segment)
    
    # Mode display
    mode = segment.get("mode", "flight")
    mode_info = format_transport_mode(mode)
    enriched.update(mode_info)
    
    # Duration
    duration = segment.get("durationMinutes") or segment.get("duration_minutes")
    if duration:
        enriched["displayDuration"] = format_duration_minutes(duration)
    
    # Cash cost
    cash = segment.get("cashCost") or segment.get("cash_cost")
    if cash is not None:
        enriched["displayCashCost"] = format_currency(cash)
    
    # Points
    points = segment.get("pointsUsed") or segment.get("points_used") or segment.get("miles")
    if points is not None:
        enriched["displayPointsUsed"] = format_points(int(points))
    
    # Surcharge
    surcharge = segment.get("surcharge")
    if surcharge is not None:
        enriched["displaySurcharge"] = format_currency(surcharge)
    
    # Cash equivalent
    cash_equiv = segment.get("cashEquivalent") or segment.get("cash_equivalent")
    if cash_equiv is not None:
        enriched["displayCashEquivalent"] = format_currency(cash_equiv)
    
    return enriched


def enrich_itinerary_response(response: Dict[str, Any]) -> Dict[str, Any]:
    """Add display fields to full itinerary response."""
    enriched = dict(response)
    
    # Cost breakdown display
    if "solution" in response and response["solution"]:
        solution = response["solution"]
        totals = solution.get("totals", {})
        
        # Total cash
        cash = totals.get("cash")
        if cash is not None:
            enriched["displayTotalCash"] = format_currency(cash)
        
        # Total points
        points = totals.get("airline_points")
        if points is not None:
            enriched["displayPointsUsed"] = format_points(int(points))
        
        # Points value
        points_value = totals.get("points_value")
        if points_value is not None:
            enriched["displayPointsValue"] = format_currency(points_value)
    
    # Out-of-pocket display
    oop = response.get("out_of_pocket") or {}
    if oop:
        best = oop.get("best_overall", {})
        if best:
            oop_value = best.get("out_of_pocket") or best.get("price") or best.get("surcharge")
            if oop_value is not None:
                enriched["displayOutOfPocket"] = format_currency(oop_value)
    
    return enriched


def build_cost_breakdown(
    cash_bookings: float = 0,
    points_surcharges: float = 0,
    total_points_used: int = 0,
    points_value_usd: float = 0,
    all_cash_cost: float = 0,
) -> Dict[str, Any]:
    """Build a comprehensive cost breakdown with display strings."""
    total_cash = cash_bookings + points_surcharges
    
    return {
        "totalCash": total_cash,
        "cashBookings": cash_bookings,
        "pointsSurcharges": points_surcharges,
        "displayTotalCash": format_currency(total_cash),
        "displayCashBookings": format_currency(cash_bookings),
        "displayPointsSurcharges": format_currency(points_surcharges),
        
        "totalPointsUsed": total_points_used,
        "displayPointsUsed": format_points(total_points_used),
        "pointsValueUsed": points_value_usd,
        "displayPointsValue": format_currency(points_value_usd),
        
        "totalTripValue": all_cash_cost,
        "displayTripValue": format_currency(all_cash_cost),
    }


def build_points_usage_summary(
    by_program: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Build points usage summary with display strings."""
    total_bank = sum(p.get("used", 0) for p in by_program if p.get("category") == "bank")
    total_airline = sum(p.get("used", 0) for p in by_program if p.get("category") == "airline")
    
    enriched_programs = []
    for prog in by_program:
        enriched = dict(prog)
        used = prog.get("used", 0)
        remaining = prog.get("remaining", 0)
        enriched["displayUsed"] = format_points(used)
        enriched["displayRemaining"] = format_points(remaining)
        enriched_programs.append(enriched)
    
    return {
        "byProgram": enriched_programs,
        "totalBankPointsUsed": total_bank,
        "displayBankPointsUsed": format_points(total_bank),
        "totalAirlineMilesUsed": total_airline,
        "displayAirlineMilesUsed": format_points(total_airline),
    }


def build_transfer_instruction(
    order: int,
    from_program: str,
    from_code: str,
    to_program: str,
    to_code: str,
    points_to_transfer: int,
    estimated_time: str = "Instant",
    instructions: Optional[List[str]] = None,
    warning: Optional[str] = None,
) -> Dict[str, Any]:
    """Build a transfer instruction with display strings."""
    return {
        "order": order,
        "fromProgram": from_program,
        "fromProgramCode": from_code,
        "toProgram": to_program,
        "toProgramCode": to_code,
        "pointsToTransfer": points_to_transfer,
        "displayPoints": format_points(points_to_transfer),
        "estimatedTime": estimated_time,
        "instructions": instructions or [],
        "warningMessage": warning,
    }
