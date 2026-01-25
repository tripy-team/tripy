"""
Date Flexibility Optimizer

Provides date flexibility scoring and multi-segment date optimization
for minimizing out-of-pocket costs.

Features:
1. Score dates by OOP (lowest surcharge + availability)
2. Multi-segment joint optimization (find best date combination)
3. Integration with Panorama calendar for award availability
4. Cash price calendar via SerpAPI
"""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any, Tuple
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class DateOOPScore:
    """OOP score for a specific date."""
    date: str  # YYYY-MM-DD
    cash_price: Optional[float]
    award_points: Optional[int]
    award_surcharge: Optional[float]
    has_award: bool
    oop: float  # Out-of-pocket cost (surcharge if award, cash if not)
    savings: float  # Cash price - OOP
    cpp: float  # Cents per point


def score_date(
    date_str: str,
    cash_price: Optional[float],
    award_data: Optional[Dict[str, Any]],
) -> DateOOPScore:
    """
    Score a single date for OOP optimization.
    
    Args:
        date_str: Date in YYYY-MM-DD format
        cash_price: Cash fare for this date (or None if unavailable)
        award_data: Award availability data with 'points' and 'surcharge' keys
    
    Returns:
        DateOOPScore with all calculated metrics
    """
    cash = cash_price if cash_price is not None else float('inf')
    
    if award_data and award_data.get("points"):
        points = int(award_data["points"])
        surcharge = float(award_data.get("surcharge", 0) or 0)
        award_oop = surcharge
        savings = cash - surcharge if cash < float('inf') else 0
        cpp = (savings * 100 / points) if points > 0 and savings > 0 else 0
        has_award = True
        oop = award_oop
    else:
        points = 0
        surcharge = 0
        has_award = False
        savings = 0
        cpp = 0
        oop = cash
    
    return DateOOPScore(
        date=date_str,
        cash_price=cash if cash < float('inf') else None,
        award_points=points if points > 0 else None,
        award_surcharge=surcharge if has_award else None,
        has_award=has_award,
        oop=oop,
        savings=savings,
        cpp=cpp,
    )


async def find_lowest_oop_dates(
    origin: str,
    destination: str,
    target_date: str,
    flexibility_days: int = 3,
    min_cpp: float = 0.5,
) -> List[DateOOPScore]:
    """
    Find dates within flexibility window that minimize OOP.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        target_date: Target date (YYYY-MM-DD)
        flexibility_days: Number of days +/- to search
        min_cpp: Minimum CPP threshold for awards
    
    Returns:
        List of DateOOPScore sorted by OOP (lowest first)
    """
    from .award_calendar import get_calendar_matrix
    from .flights import serp_route
    import httpx
    
    # Parse target date
    try:
        target_dt = datetime.strptime(target_date, "%Y-%m-%d")
    except ValueError:
        logger.error(f"Invalid date format: {target_date}")
        return []
    
    # Generate date range
    dates = []
    for offset in range(-flexibility_days, flexibility_days + 1):
        check_date = target_dt + timedelta(days=offset)
        # Don't include dates in the past
        if check_date.date() >= datetime.now().date():
            dates.append(check_date.strftime("%Y-%m-%d"))
    
    if not dates:
        return []
    
    # Fetch award calendar (covers all dates at once)
    try:
        calendar_matrix = await get_calendar_matrix(origin, destination)
    except Exception as e:
        logger.warning(f"Failed to fetch award calendar: {e}")
        calendar_matrix = []
    
    # Build award data by date
    award_by_date: Dict[str, Dict] = {}
    for row in calendar_matrix:
        date = row.get("date")
        if date not in dates:
            continue
        # Get economy cabin data
        eco = (row.get("cabins") or {}).get("economy", {})
        if eco.get("points"):
            # Keep lowest points option
            existing = award_by_date.get(date)
            if existing is None or eco["points"] < existing.get("points", float('inf')):
                award_by_date[date] = {
                    "points": eco["points"],
                    "surcharge": eco.get("tax", 0) or 0,
                    "program": row.get("program"),
                }
    
    # Fetch cash prices for each date (in parallel)
    client = httpx.AsyncClient(http2=True, timeout=httpx.Timeout(20.0))
    cash_tasks = []
    
    try:
        for date_str in dates:
            filters = {"outbound_date": date_str, "travel_class": 1}
            cash_tasks.append(serp_route(origin, destination, date_str, filters, client))
        
        cash_results = await asyncio.gather(*cash_tasks, return_exceptions=True)
    finally:
        await client.aclose()
    
    # Extract best cash price per date
    cash_by_date: Dict[str, float] = {}
    for i, result in enumerate(cash_results):
        date_str = dates[i]
        if isinstance(result, Exception):
            logger.debug(f"SERP failed for {date_str}: {result}")
            continue
        
        # Find minimum price from best_flights
        best_flights = result.get("best_flights", [])
        other_flights = result.get("other_flights", [])
        all_flights = best_flights + other_flights
        
        min_price = None
        for flight in all_flights:
            price = flight.get("price")
            if price is not None:
                try:
                    price_val = float(price)
                    if min_price is None or price_val < min_price:
                        min_price = price_val
                except (TypeError, ValueError):
                    pass
        
        if min_price is not None:
            cash_by_date[date_str] = min_price
    
    # Score all dates
    scores = []
    for date_str in dates:
        score = score_date(
            date_str,
            cash_by_date.get(date_str),
            award_by_date.get(date_str),
        )
        
        # Filter by CPP threshold
        if score.has_award and score.cpp < min_cpp:
            # Still include but mark as not meeting threshold
            score.has_award = False
            score.oop = score.cash_price if score.cash_price else float('inf')
        
        scores.append(score)
    
    # Sort by OOP (prefer dates with awards)
    return sorted(scores, key=lambda s: (not s.has_award, s.oop))


async def optimize_multi_segment_dates(
    segments: List[Tuple[str, str]],
    base_dates: List[str],
    flexibility_days: int = 2,
    min_stay_days: int = 1,
) -> Dict[str, Any]:
    """
    Find optimal date combination across multiple segments.
    
    Args:
        segments: List of (origin, destination) tuples
        base_dates: List of target dates for each segment
        flexibility_days: Number of days +/- to search per segment
        min_stay_days: Minimum days between segments
    
    Returns:
        Best date combination with total OOP
    """
    from itertools import product
    
    if len(segments) != len(base_dates):
        raise ValueError("Number of segments must match number of dates")
    
    # Get OOP scores for each segment
    segment_scores = []
    for i, ((origin, dest), base_date) in enumerate(zip(segments, base_dates)):
        scores = await find_lowest_oop_dates(
            origin, dest, base_date, flexibility_days
        )
        segment_scores.append(scores)
        logger.info(f"Segment {i} ({origin}->{dest}): {len(scores)} date options")
    
    if not all(segment_scores):
        return {
            "success": False,
            "error": "Could not find prices for one or more segments",
        }
    
    # Generate all valid date combinations
    best_combination = None
    best_oop = float('inf')
    combinations_checked = 0
    
    # Create lists of (date, score) tuples
    date_options = []
    for scores in segment_scores:
        date_options.append([(s.date, s) for s in scores])
    
    for combo in product(*date_options):
        combinations_checked += 1
        
        # Validate date sequence
        dates = [datetime.strptime(d, "%Y-%m-%d") for d, _ in combo]
        valid = True
        for i in range(1, len(dates)):
            if dates[i] < dates[i-1] + timedelta(days=min_stay_days):
                valid = False
                break
        
        if not valid:
            continue
        
        # Calculate total OOP
        total_oop = sum(score.oop for _, score in combo)
        
        if total_oop < best_oop:
            best_oop = total_oop
            best_combination = combo
    
    if best_combination is None:
        return {
            "success": False,
            "error": "No valid date combination found",
            "combinations_checked": combinations_checked,
        }
    
    # Build result
    result_segments = []
    total_savings = 0
    total_points = 0
    
    for i, (date, score) in enumerate(best_combination):
        origin, dest = segments[i]
        result_segments.append({
            "segment": f"{origin} → {dest}",
            "date": date,
            "oop": score.oop,
            "has_award": score.has_award,
            "cash_price": score.cash_price,
            "award_points": score.award_points,
            "savings": score.savings,
            "cpp": round(score.cpp, 2) if score.cpp else None,
        })
        total_savings += score.savings
        if score.award_points:
            total_points += score.award_points
    
    return {
        "success": True,
        "segments": result_segments,
        "total_oop": round(best_oop, 2),
        "total_savings": round(total_savings, 2),
        "total_points": total_points,
        "average_cpp": round(total_savings * 100 / total_points, 2) if total_points > 0 else 0,
        "combinations_checked": combinations_checked,
        "flexibility_days": flexibility_days,
    }


def find_best_dates_summary(
    scores: List[DateOOPScore],
    top_k: int = 3,
) -> Dict[str, Any]:
    """
    Generate a summary of the best dates for OOP optimization.
    
    Args:
        scores: List of DateOOPScore from find_lowest_oop_dates
        top_k: Number of top dates to include
    
    Returns:
        Summary dict for frontend display
    """
    if not scores:
        return {"dates": [], "best_date": None, "has_flexibility_savings": False}
    
    # Get top K dates with awards
    award_dates = [s for s in scores if s.has_award][:top_k]
    
    # Get top K cash-only dates
    cash_dates = [s for s in scores if not s.has_award][:top_k]
    
    best = scores[0]
    
    # Check if flexibility provides savings
    flexibility_savings = 0
    if len(scores) > 1:
        worst_oop = max(s.oop for s in scores if s.oop < float('inf'))
        flexibility_savings = worst_oop - best.oop
    
    return {
        "best_date": {
            "date": best.date,
            "oop": best.oop,
            "has_award": best.has_award,
            "savings": best.savings,
            "cpp": round(best.cpp, 2) if best.cpp else None,
        },
        "top_award_dates": [
            {
                "date": s.date,
                "oop": s.oop,
                "points": s.award_points,
                "cpp": round(s.cpp, 2),
            }
            for s in award_dates
        ],
        "top_cash_dates": [
            {
                "date": s.date,
                "price": s.cash_price,
            }
            for s in cash_dates if s.cash_price and s.cash_price < float('inf')
        ],
        "flexibility_savings": round(flexibility_savings, 2),
        "has_flexibility_savings": flexibility_savings > 50,  # Significant if > $50
    }
