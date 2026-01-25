"""
SERP provider for the v2 itinerary pipeline.

Fetches cash flight itineraries from SerpAPI Google Flights
and normalizes them to EdgeOption format.
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import date
from typing import List, Optional, Dict, Any

from ..schemas import EdgeOption
from ..cache import cache_serp_get, cache_serp_set
from .http_logging import log_api_call

logger = logging.getLogger(__name__)


def _build_option_id(origin: str, dest: str, date_str: str, segments: List[dict]) -> str:
    """Build a stable option_id from origin/dest/date + segment list."""
    # Hash segment info for uniqueness
    seg_info = ":".join(
        f"{s.get('flight_number', '')}:{s.get('departure_airport', {}).get('id', '')}:{s.get('arrival_airport', {}).get('id', '')}"
        for s in segments
    )
    combined = f"{origin}:{dest}:{date_str}:{seg_info}"
    h = hashlib.sha256(combined.encode("utf-8")).hexdigest()[:12]
    return f"serp_{origin}_{dest}_{date_str}_{h}"


def _extract_segments(flights: List[dict]) -> List[dict]:
    """Extract segment info from SERP flights array."""
    segments = []
    for f in flights:
        seg = {
            "flight_number": f.get("flight_number", ""),
            "departure_airport": f.get("departure_airport", {}),
            "arrival_airport": f.get("arrival_airport", {}),
            "duration": f.get("duration"),
            "airline": f.get("airline"),
            "airline_logo": f.get("airline_logo"),
            "departure_time": f.get("departure_airport", {}).get("time"),
            "arrival_time": f.get("arrival_airport", {}).get("time"),
            "travel_class": f.get("travel_class"),
            "airplane": f.get("airplane"),
            "legroom": f.get("legroom"),
        }
        segments.append(seg)
    return segments


async def fetch_serp_options(
    origin: str,
    destination: str,
    leg_date: date,
    run_id: str,
    travel_class: str = "economy",
    pax: int = 1,
    deep_search: bool = True,
) -> List[EdgeOption]:
    """
    Fetch flight options from SerpAPI Google Flights.
    
    Args:
        origin: Origin airport IATA code
        destination: Destination airport IATA code
        leg_date: Travel date
        run_id: Correlation ID for logging
        travel_class: Travel class (economy, business, first)
        pax: Number of passengers
        deep_search: Whether to use SerpAPI deep search
        
    Returns:
        List of EdgeOption objects representing cash flight options
    """
    import asyncio
    
    date_str = leg_date.strftime("%Y-%m-%d")
    
    # Check cache first
    cached = cache_serp_get(origin, destination, date_str, travel_class, pax)
    if cached is not None:
        logger.debug(f"SERP cache hit for {origin}->{destination} on {date_str}")
        return _parse_serp_response(cached, origin, destination, leg_date, date_str)
    
    # Fetch from SERP
    start_time = time.time()
    status_code = None
    response_body = None
    error_msg = None
    
    try:
        from src.handlers.serp_client import get_flights_between_airports
        
        # Map travel class to SERP travel_class int
        class_map = {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}
        tc = class_map.get(travel_class.lower(), 1)
        
        response_body = await asyncio.to_thread(
            get_flights_between_airports,
            origin,
            destination,
            date_str,
            travel_class=tc,
            deep_search=deep_search,
        )
        
        status_code = 200 if response_body else 204
        
        # Cache the response
        if response_body:
            cache_serp_set(origin, destination, date_str, response_body, travel_class, pax)
        
    except Exception as e:
        error_msg = str(e)
        logger.warning(f"SERP fetch failed for {origin}->{destination}: {e}")
        response_body = []
    
    elapsed_ms = int((time.time() - start_time) * 1000)
    
    # Log the API call
    log_api_call(
        run_id=run_id,
        provider="SERP",
        method="GET",
        url=f"serpapi.com/google_flights?departure_id={origin}&arrival_id={destination}&outbound_date={date_str}",
        request_summary={
            "origin": origin,
            "destination": destination,
            "date": date_str,
            "travel_class": travel_class,
            "pax": pax,
        },
        status_code=status_code,
        response_summary={
            "count": len(response_body) if response_body else 0,
            "min_price": min((f.get("price", 0) for f in response_body), default=None) if response_body else None,
            "error": error_msg,
        },
        elapsed_ms=elapsed_ms,
    )
    
    return _parse_serp_response(response_body or [], origin, destination, leg_date, date_str)


def _parse_serp_response(
    items: List[dict],
    origin: str,
    destination: str,
    leg_date: date,
    date_str: str,
) -> List[EdgeOption]:
    """Parse SERP response items to EdgeOption list."""
    options = []
    
    for item in items:
        price = item.get("price")
        if price is None:
            continue
        
        try:
            cash_usd = float(price)
        except (ValueError, TypeError):
            continue
        
        flights = item.get("flights", [])
        segments = _extract_segments(flights)
        
        # Calculate total duration
        total_duration = item.get("total_duration")
        if total_duration is None and flights:
            total_duration = sum(f.get("duration", 0) for f in flights)
        
        # Count stops
        stops = len(flights) - 1 if len(flights) > 1 else 0
        
        # Get operating airline from first segment
        operating_airline = None
        if flights:
            operating_airline = flights[0].get("airline")
        
        option_id = _build_option_id(origin, destination, date_str, segments)
        
        option = EdgeOption(
            option_id=option_id,
            origin=origin,
            destination=destination,
            date=leg_date,
            mode="flight",
            cash_usd=cash_usd,
            duration_min=total_duration,
            stops=stops,
            segments=segments,
            operating_airline=operating_airline,
        )
        options.append(option)
    
    return options


async def fetch_serp_options_batch(
    legs: List[tuple[str, str, date]],
    run_id: str,
    travel_class: str = "economy",
    pax: int = 1,
    max_concurrent: int = 6,
) -> Dict[tuple[str, str, date], List[EdgeOption]]:
    """
    Fetch SERP options for multiple legs in parallel.
    
    Args:
        legs: List of (origin, destination, date) tuples
        run_id: Correlation ID for logging
        travel_class: Travel class
        pax: Number of passengers
        max_concurrent: Maximum concurrent requests
        
    Returns:
        Dict mapping (origin, dest, date) to list of EdgeOptions
    """
    import asyncio
    
    sem = asyncio.Semaphore(max_concurrent)
    
    async def fetch_with_sem(origin: str, dest: str, leg_date: date):
        async with sem:
            return await fetch_serp_options(
                origin, dest, leg_date, run_id, travel_class, pax
            )
    
    tasks = [fetch_with_sem(o, d, dt) for o, d, dt in legs]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    output = {}
    for i, (o, d, dt) in enumerate(legs):
        result = results[i]
        if isinstance(result, Exception):
            logger.warning(f"SERP fetch exception for {o}->{d}: {result}")
            output[(o, d, dt)] = []
        else:
            output[(o, d, dt)] = result
    
    return output
