"""
AwardTool provider for the v2 itinerary pipeline.

Fetches award flight quotes from AwardTool API
and normalizes them to EdgeOption format.

For v2 first cut, we use route-level award proxy:
- Query AwardTool for (origin, dest, date, program, cabin)
- Select min miles+fees per program for that route/day
- Emit award-only options for optimization
"""

from __future__ import annotations

import hashlib
import logging
import os
import time
from datetime import date
from typing import List, Optional, Dict, Any

from ..schemas import EdgeOption
from ..cache import cache_award_get, cache_award_set
from .http_logging import log_api_call

logger = logging.getLogger(__name__)

# Default programs to query if not specified
DEFAULT_AWARD_PROGRAMS = ["UA", "AA", "DL", "BA", "AF", "VS", "AV", "AC", "AS"]
DEFAULT_CABINS = ["economy", "business"]


def _build_award_option_id(
    origin: str,
    dest: str,
    date_str: str,
    program: str,
    cabin: str,
) -> str:
    """Build a stable option_id for award options."""
    combined = f"award:{origin}:{dest}:{date_str}:{program}:{cabin}"
    h = hashlib.sha256(combined.encode("utf-8")).hexdigest()[:12]
    return f"award_{origin}_{dest}_{date_str}_{program}_{cabin}_{h}"


async def fetch_award_options(
    origin: str,
    destination: str,
    leg_date: date,
    run_id: str,
    programs: Optional[List[str]] = None,
    cabins: Optional[List[str]] = None,
    pax: int = 1,
) -> List[EdgeOption]:
    """
    Fetch award flight quotes via the self-hosted AwardPricingEngine.

    Args:
        origin: Origin airport IATA code
        destination: Destination airport IATA code
        leg_date: Travel date
        run_id: Correlation ID for logging
        programs: List of airline programs to query (e.g., ["UA", "AA"])
        cabins: List of cabins to query (e.g., ["economy", "business"])
        pax: Number of passengers
        
    Returns:
        List of EdgeOption objects representing award options
    """
    programs = programs or DEFAULT_AWARD_PROGRAMS
    cabins = cabins or DEFAULT_CABINS
    date_str = leg_date.strftime("%Y-%m-%d")

    # Check cache first
    cached = cache_award_get(origin, destination, date_str, cabins, programs, pax)
    if cached is not None:
        logger.debug(f"Award cache hit for {origin}->{destination} on {date_str}")
        return _parse_award_response(cached, origin, destination, leg_date, date_str)

    start_time = time.time()
    error_msg = None
    try:
        # Self-hosted AwardPricingEngine (charts -> cash-derived -> synthetic floor).
        from src.award_pricing import search_award_flights
        body = search_award_flights(origin, destination, date_str, cabins, programs, int(pax))
        rows = body.get("data", []) if isinstance(body, dict) else []
        quotes = [
            {
                "program": (r.get("program_code") or r.get("airline_code") or "").upper(),
                "miles": r.get("award_points"),
                "surcharge": r.get("surcharge", 0),
                "cabin": r.get("cabin", "economy"),
                "segments": r.get("segments", []),
                "duration": r.get("duration") or r.get("duration_minutes"),
                "stops": r.get("stops", 0),
            }
            for r in rows
        ]
        response_body: Dict[str, Any] = {"quotes": quotes}
        cache_award_set(origin, destination, date_str, cabins, programs, response_body, pax)
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"Award engine fetch failed for {origin}->{destination}: {e}")
        response_body = {"quotes": []}

    elapsed_ms = int((time.time() - start_time) * 1000)

    quotes = response_body.get("quotes", [])
    min_miles = min((q.get("miles") or 0 for q in quotes), default=None) if quotes else None

    log_api_call(
        run_id=run_id,
        provider="AwardPricingEngine",
        method="LOCAL",
        url="self-hosted:search_award_flights",
        request_summary={
            "origin": origin,
            "destination": destination,
            "date": date_str,
            "programs": programs,
            "cabins": cabins,
            "pax": pax,
        },
        status_code=200 if not error_msg else 500,
        response_summary={
            "count": len(quotes),
            "min_miles": min_miles,
            "programs_returned": sorted({q.get("program", "") for q in quotes}),
            "error": error_msg,
        },
        elapsed_ms=elapsed_ms,
    )

    return _parse_award_response(response_body, origin, destination, leg_date, date_str)


def _parse_award_response(
    data: Any,
    origin: str,
    destination: str,
    leg_date: date,
    date_str: str,
) -> List[EdgeOption]:
    """Parse AwardTool response to EdgeOption list."""
    options = []
    
    # Handle both list and dict with "quotes" key
    quotes = data.get("quotes", []) if isinstance(data, dict) else data
    if not isinstance(quotes, list):
        quotes = []
    
    # Group by program to get min miles per program
    program_best: Dict[str, dict] = {}
    
    for quote in quotes:
        program = quote.get("program", "").upper()
        if not program:
            continue
        
        miles = quote.get("miles") or quote.get("points")
        if miles is None:
            continue
        
        try:
            miles = int(miles)
        except (ValueError, TypeError):
            continue
        
        surcharge = float(quote.get("surcharge", 0) or quote.get("taxes", 0) or 0)
        cabin = quote.get("cabin", "economy")
        
        # Keep the best (lowest miles) option per program+cabin
        key = f"{program}:{cabin}"
        if key not in program_best or miles < program_best[key].get("miles", float("inf")):
            program_best[key] = {
                "program": program,
                "miles": miles,
                "surcharge": surcharge,
                "cabin": cabin,
                "segments": quote.get("segments", []),
                "duration": quote.get("duration"),
                "stops": quote.get("stops", 0),
            }
    
    # Convert to EdgeOptions
    for key, best in program_best.items():
        program = best["program"]
        cabin = best["cabin"]
        
        option_id = _build_award_option_id(origin, destination, date_str, program, cabin)
        
        option = EdgeOption(
            option_id=option_id,
            origin=origin,
            destination=destination,
            date=leg_date,
            mode="flight",
            award_program=program,
            award_miles=best["miles"],
            award_surcharge_usd=best["surcharge"],
            duration_min=best.get("duration"),
            stops=best.get("stops", 0),
            segments=best.get("segments", []),
            operating_airline=program,  # For award, program is often the operating airline
        )
        options.append(option)
    
    return options


async def fetch_award_options_batch(
    legs: List[tuple[str, str, date]],
    run_id: str,
    programs: Optional[List[str]] = None,
    cabins: Optional[List[str]] = None,
    pax: int = 1,
    max_concurrent: int = 6,
) -> Dict[tuple[str, str, date], List[EdgeOption]]:
    """
    Fetch AwardTool options for multiple legs in parallel.
    
    Args:
        legs: List of (origin, destination, date) tuples
        run_id: Correlation ID for logging
        programs: List of programs to query
        cabins: List of cabins to query
        pax: Number of passengers
        max_concurrent: Maximum concurrent requests
        
    Returns:
        Dict mapping (origin, dest, date) to list of EdgeOptions
    """
    import asyncio
    
    sem = asyncio.Semaphore(max_concurrent)
    
    async def fetch_with_sem(origin: str, dest: str, leg_date: date):
        async with sem:
            return await fetch_award_options(
                origin, dest, leg_date, run_id, programs, cabins, pax
            )
    
    tasks = [fetch_with_sem(o, d, dt) for o, d, dt in legs]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    output = {}
    for i, (o, d, dt) in enumerate(legs):
        result = results[i]
        if isinstance(result, Exception):
            logger.warning(f"AwardTool fetch exception for {o}->{d}: {result}")
            output[(o, d, dt)] = []
        else:
            output[(o, d, dt)] = result
    
    return output
