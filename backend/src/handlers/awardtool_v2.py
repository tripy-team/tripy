# backend/src/handlers/awardtool_v2.py
"""
AwardTool API v2 Client - Two-Phase Priming + Polling Architecture

This module implements the new AwardTool API v2 which uses:
1. Priming Phase: Initiates an async search across airline programs
2. Polling Phase: Retrieves incremental results until search completes

Benefits over v1:
- Non-blocking priming prevents timeouts on slow searches
- Progressive results enable partial data return on timeout
- Better reliability with graceful degradation
"""

import asyncio
import uuid
import logging
import os
import time
from typing import List, Dict, Optional, Callable, Set
from dataclasses import dataclass, field

import httpx
from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

# =============================================================================
# API Configuration
# =============================================================================

# API v2 Endpoints
PRIMING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_trigger/search_real_time"
POLLING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_retrieval/search_result"

# Default polling configuration
DEFAULT_POLL_INTERVAL = int(os.getenv("AWARDTOOL_POLL_INTERVAL", "5"))  # seconds
DEFAULT_MAX_POLL_TIME = int(os.getenv("AWARDTOOL_MAX_POLL_TIME", "60"))  # seconds
DEFAULT_POLL_TIMEOUT = 10  # timeout per poll request
DEFAULT_PRIME_TIMEOUT = 10  # timeout per prime request

# Program batching - split programs into groups for parallel priming
DEFAULT_PROGRAM_BATCH_SIZE = int(os.getenv("AWARDTOOL_PROGRAM_BATCH_SIZE", "3"))

# HTTP client config
TIMEOUT_CONFIG = httpx.Timeout(connect=5.0, read=DEFAULT_POLL_TIMEOUT, write=5.0, pool=5.0)


# =============================================================================
# Data Classes
# =============================================================================

@dataclass
class AwardSearchConfig:
    """Configuration for an award flight search."""
    origin: str
    destination: str
    date: str
    cabins: List[str]
    pax: int
    programs: List[str]
    api_key: str
    
    # Polling settings
    poll_interval: int = DEFAULT_POLL_INTERVAL
    max_poll_time: int = DEFAULT_MAX_POLL_TIME
    
    # Program batching
    program_batch_size: int = DEFAULT_PROGRAM_BATCH_SIZE


@dataclass
class AwardSearchResult:
    """Result from an award flight search."""
    task_id: str
    flights: List[Dict]
    programs_done: List[str]
    programs_requested: List[str]
    finished: bool
    total_polls: int
    elapsed_time: float
    missing_keys: List[str] = field(default_factory=list)
    error: Optional[str] = None


@dataclass
class PollProgress:
    """Progress information during polling (for callbacks)."""
    poll_number: int
    elapsed_time: float
    flights_so_far: int
    programs_done: List[str]
    finished: bool


# =============================================================================
# Helper Functions
# =============================================================================

def _flight_key(flight: Dict) -> str:
    """
    Generate a unique key for a flight to avoid duplicates.
    
    Uses combination of route, program, points, and flight number.
    """
    origin = flight.get("origin", "") or flight.get("Origin", "")
    dest = flight.get("destination", "") or flight.get("Destination", "")
    program = flight.get("program_code", "") or flight.get("Program", "")
    points = flight.get("award_points", "") or flight.get("Miles", "")
    flight_num = flight.get("flight_number", "") or flight.get("FlightNumber", "")
    cabin = flight.get("cabin", "") or flight.get("Cabin", "")
    return f"{origin}:{dest}:{program}:{points}:{flight_num}:{cabin}"


def _create_http_client() -> httpx.AsyncClient:
    """Create a configured HTTP client for API requests."""
    return httpx.AsyncClient(
        http2=True,
        headers={
            "User-Agent": "Tripy/2.0 (+https://tripy.app)",
            "Content-Type": "application/json",
        },
        timeout=TIMEOUT_CONFIG,
    )


# =============================================================================
# Priming Phase
# =============================================================================

async def _send_priming_request(
    client: httpx.AsyncClient,
    config: AwardSearchConfig,
    task_id: str,
    programs_batch: List[str],
) -> bool:
    """
    Send a single priming request for a batch of programs.
    
    Args:
        client: HTTP client
        config: Search configuration
        task_id: Unique task identifier for this search
        programs_batch: List of program codes to search in this batch
    
    Returns:
        True if priming succeeded, False otherwise.
    """
    payload = {
        "origin": config.origin.upper(),
        "destination": config.destination.upper(),
        "date": config.date,
        "pax": config.pax,
        "programs": [p.upper() for p in programs_batch],
        "cabins": config.cabins,
        "task_id": task_id,
        "api_key": config.api_key,
        "exit_early": True,  # Required for polling pattern
    }
    
    try:
        response = await client.post(
            PRIMING_ENDPOINT,
            json=payload,
            timeout=httpx.Timeout(connect=5.0, read=DEFAULT_PRIME_TIMEOUT, write=5.0, pool=5.0),
        )
        
        if response.status_code == 200:
            logger.info(
                "AwardTool v2 priming success: %s->%s programs=%s task_id=%s",
                config.origin, config.destination, programs_batch, task_id[:8]
            )
            return True
        else:
            logger.warning(
                "AwardTool v2 priming failed: %s->%s status=%d body=%s",
                config.origin, config.destination, 
                response.status_code, response.text[:200]
            )
            return False
            
    except httpx.TimeoutException:
        logger.warning(
            "AwardTool v2 priming timeout: %s->%s programs=%s",
            config.origin, config.destination, programs_batch
        )
        return False
    except Exception as e:
        logger.error(
            "AwardTool v2 priming error: %s->%s error=%s",
            config.origin, config.destination, str(e)
        )
        return False


async def prime_search(
    client: httpx.AsyncClient,
    config: AwardSearchConfig,
    task_id: str,
) -> int:
    """
    Prime the search by sending requests for all program batches.
    
    Programs are split into batches and primed in parallel for efficiency.
    
    Args:
        client: HTTP client
        config: Search configuration
        task_id: Unique task identifier
    
    Returns:
        Number of successfully primed batches.
    """
    # Split programs into batches
    programs = config.programs
    batch_size = config.program_batch_size
    batches = [
        programs[i:i + batch_size] 
        for i in range(0, len(programs), batch_size)
    ]
    
    logger.info(
        "AwardTool v2 priming: %s->%s batches=%d programs=%d task_id=%s",
        config.origin, config.destination, len(batches), len(programs), task_id[:8]
    )
    
    # Prime all batches in parallel
    tasks = [
        _send_priming_request(client, config, task_id, batch)
        for batch in batches
    ]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Count successes (excluding exceptions)
    success_count = sum(1 for r in results if r is True)
    
    logger.info(
        "AwardTool v2 priming complete: %s->%s success=%d/%d batches task_id=%s",
        config.origin, config.destination, success_count, len(batches), task_id[:8]
    )
    
    return success_count


# =============================================================================
# Polling Phase
# =============================================================================

async def _poll_once(
    client: httpx.AsyncClient,
    task_id: str,
    api_key: str,
) -> Optional[Dict]:
    """
    Execute a single poll request.
    
    Args:
        client: HTTP client
        task_id: Task identifier from priming
        api_key: API key
    
    Returns:
        Response data dict or None on error.
    """
    payload = {
        "task_id": task_id,
        "api_key": api_key,
    }
    
    try:
        response = await client.post(
            POLLING_ENDPOINT,
            json=payload,
            timeout=httpx.Timeout(connect=5.0, read=DEFAULT_POLL_TIMEOUT, write=5.0, pool=5.0),
        )
        
        if response.status_code == 200:
            return response.json()
        else:
            logger.warning(
                "AwardTool v2 poll failed: task_id=%s status=%d body=%s",
                task_id[:8], response.status_code, response.text[:200]
            )
            return None
            
    except httpx.TimeoutException:
        logger.warning("AwardTool v2 poll timeout: task_id=%s", task_id[:8])
        return None
    except Exception as e:
        logger.error("AwardTool v2 poll error: task_id=%s error=%s", task_id[:8], str(e))
        return None


async def poll_for_results(
    client: httpx.AsyncClient,
    config: AwardSearchConfig,
    task_id: str,
    on_progress: Optional[Callable[[PollProgress], None]] = None,
) -> AwardSearchResult:
    """
    Poll for results until search completes or timeout.
    
    This function:
    1. Periodically polls the API for new results
    2. Accumulates all flights found (with deduplication)
    3. Tracks which programs have completed
    4. Stops when search is finished or max time exceeded
    
    Args:
        client: HTTP client
        config: Search configuration
        task_id: Task ID from priming
        on_progress: Optional callback for progress updates
    
    Returns:
        AwardSearchResult with accumulated flights (may be partial on timeout).
    """
    all_flights: List[Dict] = []
    flights_seen: Set[str] = set()  # Deduplicate by flight key
    programs_done: List[str] = []
    missing_keys: List[str] = []
    
    poll_count = 0
    max_polls = config.max_poll_time // config.poll_interval
    start_time = time.time()
    finished = False
    
    for i in range(max_polls):
        poll_count += 1
        elapsed = time.time() - start_time
        
        logger.debug(
            "AwardTool v2 poll #%d: task_id=%s elapsed=%.1fs",
            poll_count, task_id[:8], elapsed
        )
        
        # Execute poll
        data = await _poll_once(client, task_id, config.api_key)
        
        if data:
            # Extract new flights (API returns incremental results)
            new_flights = data.get("result", [])
            
            # Deduplicate flights by unique key
            added_count = 0
            for flight in new_flights:
                flight_key = _flight_key(flight)
                if flight_key not in flights_seen:
                    flights_seen.add(flight_key)
                    all_flights.append(flight)
                    added_count += 1
            
            # Update metadata from poll response
            finished = data.get("finish", False)
            programs_done = data.get("program_done", []) or []
            missing_keys = data.get("missing_keys", []) or []
            
            logger.info(
                "AwardTool v2 poll #%d: new=%d added=%d total=%d programs_done=%s finished=%s task_id=%s",
                poll_count, len(new_flights), added_count, len(all_flights),
                ",".join(programs_done) if programs_done else "none", finished, task_id[:8]
            )
            
            # Call progress callback if provided (for streaming to frontend)
            if on_progress:
                try:
                    progress = PollProgress(
                        poll_number=poll_count,
                        elapsed_time=elapsed,
                        flights_so_far=len(all_flights),
                        programs_done=programs_done,
                        finished=finished,
                    )
                    on_progress(progress)
                except Exception as e:
                    logger.warning("Progress callback error: %s", str(e))
            
            # Exit if search is complete
            if finished:
                logger.info(
                    "AwardTool v2 search complete: task_id=%s flights=%d polls=%d elapsed=%.1fs",
                    task_id[:8], len(all_flights), poll_count, elapsed
                )
                break
        
        # Wait before next poll (unless last iteration or finished)
        if i < max_polls - 1 and not finished:
            await asyncio.sleep(config.poll_interval)
    
    elapsed = time.time() - start_time
    
    # Log warning if we timed out with partial results
    if not finished:
        logger.warning(
            "AwardTool v2 poll timeout: returning partial results "
            "(%d flights from %d/%d programs) task_id=%s elapsed=%.1fs",
            len(all_flights), len(programs_done), len(config.programs), task_id[:8], elapsed
        )
    
    return AwardSearchResult(
        task_id=task_id,
        flights=all_flights,
        programs_done=programs_done,
        programs_requested=config.programs,
        finished=finished,
        total_polls=poll_count,
        elapsed_time=elapsed,
        missing_keys=missing_keys,
    )


# =============================================================================
# Main Search Function
# =============================================================================

async def search_award_flights_v2(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str],
    pax: int,
    programs: List[str],
    api_key: str,
    poll_interval: int = DEFAULT_POLL_INTERVAL,
    max_poll_time: int = DEFAULT_MAX_POLL_TIME,
    program_batch_size: int = DEFAULT_PROGRAM_BATCH_SIZE,
    on_progress: Optional[Callable[[PollProgress], None]] = None,
) -> AwardSearchResult:
    """
    Execute a complete award flight search using AwardTool API v2.
    
    This is the main entry point that:
    1. Generates a unique task_id for billing/tracking
    2. Primes the search across all programs (batched in parallel)
    3. Polls for results until complete or timeout
    4. Returns accumulated results (may be partial on timeout)
    
    Args:
        origin: Origin airport code (e.g., "JFK")
        destination: Destination airport code (e.g., "CDG")
        date: Travel date in YYYY-MM-DD format
        cabins: List of cabin classes (e.g., ["Economy", "Business"])
        pax: Number of passengers
        programs: List of airline programs to search (e.g., ["UA", "AA", "DL"])
        api_key: AwardTool API key
        poll_interval: Seconds between poll requests (default 5)
        max_poll_time: Maximum seconds to poll (default 60)
        program_batch_size: Programs per priming request (default 3)
        on_progress: Optional callback for progress updates
    
    Returns:
        AwardSearchResult with all accumulated flights.
    """
    # Generate unique task ID for this search
    # Important: Billing is based on unique task_id
    task_id = str(uuid.uuid4())
    
    logger.info(
        "AwardTool v2 search start: %s->%s date=%s task_id=%s programs=%d",
        origin, destination, date, task_id[:8], len(programs)
    )
    
    config = AwardSearchConfig(
        origin=origin,
        destination=destination,
        date=date,
        cabins=cabins,
        pax=pax,
        programs=programs,
        api_key=api_key,
        poll_interval=poll_interval,
        max_poll_time=max_poll_time,
        program_batch_size=program_batch_size,
    )
    
    client = _create_http_client()
    try:
        # Phase 1: Prime the search
        primed_batches = await prime_search(client, config, task_id)
        
        if primed_batches == 0:
            logger.error(
                "AwardTool v2 search failed: no batches primed %s->%s task_id=%s",
                origin, destination, task_id[:8]
            )
            return AwardSearchResult(
                task_id=task_id,
                flights=[],
                programs_done=[],
                programs_requested=programs,
                finished=False,
                total_polls=0,
                elapsed_time=0.0,
                missing_keys=[],
                error="All priming requests failed",
            )
        
        # Brief delay before polling to allow server to process
        await asyncio.sleep(1)
        
        # Phase 2: Poll for results
        result = await poll_for_results(client, config, task_id, on_progress)
        
        logger.info(
            "AwardTool v2 search complete: %s->%s flights=%d time=%.1fs finished=%s task_id=%s",
            origin, destination, len(result.flights), result.elapsed_time, result.finished, task_id[:8]
        )
        
        return result
        
    finally:
        await client.aclose()


# =============================================================================
# Conversion to V1 Format (for backward compatibility)
# =============================================================================

def convert_v2_result_to_v1_format(result: AwardSearchResult) -> Dict:
    """
    Convert v2 result format to v1 format for compatibility with existing code.
    
    V2 returns flights directly, V1 expects {"data": [...]} with nested structure.
    This allows the existing _merge_award_edges() function to work unchanged.
    
    Args:
        result: AwardSearchResult from v2 search
    
    Returns:
        Dict in v1 format: {"data": [...normalized items...]}
    """
    normalized_data = []
    
    for flight in result.flights:
        # Handle both v2 field names and potential variations
        origin = flight.get("origin") or flight.get("Origin") or ""
        destination = flight.get("destination") or flight.get("Destination") or ""
        program_code = flight.get("program_code") or flight.get("Program") or ""
        award_points = flight.get("award_points") or flight.get("Miles")
        surcharge = flight.get("surcharge") or flight.get("taxes_and_fees") or flight.get("TaxesAndFees")
        flight_number = flight.get("flight_number") or flight.get("FlightNumber") or ""
        departure_time = flight.get("departure_time") or flight.get("DepartureTime")
        arrival_time = flight.get("arrival_time") or flight.get("ArrivalTime")
        operating_carrier = flight.get("operating_carrier") or flight.get("OperatingCarrier") or ""
        cabin = flight.get("cabin") or flight.get("Cabin") or "Economy"
        duration = flight.get("duration") or flight.get("travel_minutes") or flight.get("Duration")
        transfer_options = flight.get("transfer_options") or []
        
        # Build v1-compatible item structure
        normalized_item = {
            "program_code": program_code.upper() if program_code else "",
            "award_points": int(award_points) if award_points else None,
            "surcharge": float(surcharge) if surcharge else None,
            "transfer_options": transfer_options,
            "fare": {
                "products": [{
                    "origin": origin.upper() if origin else "",
                    "destination": destination.upper() if destination else "",
                    "flight_number": flight_number,
                    "departure_time": departure_time,
                    "arrival_time": arrival_time,
                    "operating_carrier": operating_carrier,
                    "travel_minutes": duration,
                    "cabin": cabin,
                }],
                "travel_minutes_total": duration,
            },
        }
        normalized_data.append(normalized_item)
    
    return {
        "data": normalized_data,
        "task_id": result.task_id,
        "programs_done": result.programs_done,
        "finished": result.finished,
        "v2_metadata": {
            "total_polls": result.total_polls,
            "elapsed_time": result.elapsed_time,
            "missing_keys": result.missing_keys,
        },
    }


# =============================================================================
# Sync Wrapper for Compatibility
# =============================================================================

def search_award_flights_v2_sync(
    origin: str,
    destination: str,
    date: str,
    cabins: List[str],
    pax: int,
    programs: List[str],
    api_key: str,
    **kwargs,
) -> AwardSearchResult:
    """
    Synchronous wrapper for search_award_flights_v2.
    
    Use this when calling from synchronous code.
    """
    return asyncio.run(
        search_award_flights_v2(
            origin=origin,
            destination=destination,
            date=date,
            cabins=cabins,
            pax=pax,
            programs=programs,
            api_key=api_key,
            **kwargs,
        )
    )
