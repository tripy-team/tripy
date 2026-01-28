# AwardTool API v2 Integration Plan

## Executive Summary

This document outlines the implementation plan to migrate Tripy from the current synchronous AwardTool API to the new **API v2** which uses a two-phase **priming + polling** architecture. This change will improve reliability, enable progressive result loading, and provide better timeout handling.

---

## Current vs. New Architecture

### Current Implementation (API v1)

```
┌─────────────────┐     POST (blocking)      ┌─────────────────────────────┐
│  Tripy Backend  │ ───────────────────────► │ awardtool-api.com           │
│                 │                          │ /search_real_time           │
│                 │ ◄─────────────────────── │                             │
└─────────────────┘     Response (all data)  └─────────────────────────────┘

Problems:
- Blocking call can timeout on slow routes (25s limit)
- All-or-nothing: no partial results on timeout
- Single request for all 22 programs can overload
```

### New Implementation (API v2)

```
┌─────────────────┐                          ┌─────────────────────────────┐
│  Tripy Backend  │                          │ apisv2.awardtoolapi.com     │
│                 │                          │                             │
│  1. Prime       │ ──POST (non-blocking)──► │ /flight_trigger/            │
│                 │                          │    search_real_time         │
│                 │ ◄───── 200 OK ────────── │                             │
│                 │                          │                             │
│  2. Poll        │ ──POST ────────────────► │ /flight_retrieval/          │
│     (repeat)    │                          │    search_result            │
│                 │ ◄── incremental data ─── │                             │
│                 │                          │                             │
│  3. Complete    │     finish: true         │                             │
└─────────────────┘                          └─────────────────────────────┘

Benefits:
- Non-blocking priming → no timeout on initiation
- Progressive results → show users data as it arrives
- Graceful timeout → return partial results if max time exceeded
- Better billing → single task_id for all program batches
```

---

## API Endpoints

| Phase | Endpoint | Method |
|-------|----------|--------|
| **Priming** | `https://apisv2.awardtoolapi.com/flight_trigger/search_real_time` | POST |
| **Polling** | `https://apisv2.awardtoolapi.com/flight_retrieval/search_result` | POST |

---

## Implementation Phases

### Phase 1: Core API Client Module

**File:** `backend/src/handlers/awardtool_v2.py` (new file)

Create a dedicated module for the new API with clean separation of concerns.

```python
# backend/src/handlers/awardtool_v2.py

import asyncio
import uuid
import logging
import httpx
from typing import List, Dict, Optional, Callable
from dataclasses import dataclass

logger = logging.getLogger(__name__)

# =============================================================================
# Configuration
# =============================================================================

PRIMING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_trigger/search_real_time"
POLLING_ENDPOINT = "https://apisv2.awardtoolapi.com/flight_retrieval/search_result"

# Polling configuration
DEFAULT_POLL_INTERVAL = 5  # seconds between polls
DEFAULT_MAX_POLL_TIME = 60  # max seconds to poll
DEFAULT_POLL_TIMEOUT = 10  # timeout per poll request

# Program batching - split programs into groups for parallel priming
DEFAULT_PROGRAM_BATCH_SIZE = 3

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
    missing_keys: List[str]


@dataclass
class PollProgress:
    """Progress information during polling (for callbacks)."""
    poll_number: int
    elapsed_time: float
    flights_so_far: int
    programs_done: List[str]
    finished: bool
```

### Phase 2: Priming Implementation

```python
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
    
    Returns True if priming succeeded, False otherwise.
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
            timeout=httpx.Timeout(connect=5.0, read=10.0, write=5.0, pool=5.0),
        )
        
        if response.status_code == 200:
            logger.info(
                "AwardTool v2 priming success: %s->%s programs=%s",
                config.origin, config.destination, programs_batch
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
    
    Returns the number of successfully primed batches.
    """
    # Split programs into batches
    programs = config.programs
    batch_size = config.program_batch_size
    batches = [
        programs[i:i + batch_size] 
        for i in range(0, len(programs), batch_size)
    ]
    
    logger.info(
        "AwardTool v2 priming: %s->%s batches=%d programs=%d",
        config.origin, config.destination, len(batches), len(programs)
    )
    
    # Prime all batches in parallel
    tasks = [
        _send_priming_request(client, config, task_id, batch)
        for batch in batches
    ]
    results = await asyncio.gather(*tasks)
    
    success_count = sum(1 for r in results if r)
    logger.info(
        "AwardTool v2 priming complete: %s->%s success=%d/%d batches",
        config.origin, config.destination, success_count, len(batches)
    )
    
    return success_count
```

### Phase 3: Polling Implementation

```python
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
    
    Returns the response data or None on error.
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
                "AwardTool v2 poll failed: task_id=%s status=%d",
                task_id[:8], response.status_code
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
    
    Args:
        client: HTTP client
        config: Search configuration
        task_id: Task ID from priming
        on_progress: Optional callback for progress updates (for streaming to frontend)
    
    Returns:
        AwardSearchResult with accumulated flights
    """
    all_flights = []
    flights_seen = set()  # Deduplicate by flight key
    programs_done = []
    missing_keys = []
    
    poll_count = 0
    max_polls = config.max_poll_time // config.poll_interval
    start_time = asyncio.get_event_loop().time()
    finished = False
    
    for i in range(max_polls):
        poll_count += 1
        elapsed = asyncio.get_event_loop().time() - start_time
        
        logger.debug(
            "AwardTool v2 poll #%d: task_id=%s elapsed=%.1fs",
            poll_count, task_id[:8], elapsed
        )
        
        # Execute poll
        data = await _poll_once(client, task_id, config.api_key)
        
        if data:
            # Extract new flights (incremental)
            new_flights = data.get("result", [])
            
            # Deduplicate flights
            for flight in new_flights:
                # Create unique key for flight
                flight_key = _flight_key(flight)
                if flight_key not in flights_seen:
                    flights_seen.add(flight_key)
                    all_flights.append(flight)
            
            # Update metadata
            finished = data.get("finish", False)
            programs_done = data.get("program_done", [])
            missing_keys = data.get("missing_keys", [])
            
            logger.info(
                "AwardTool v2 poll #%d: new=%d total=%d programs_done=%s finished=%s",
                poll_count, len(new_flights), len(all_flights),
                ",".join(programs_done) if programs_done else "none", finished
            )
            
            # Call progress callback if provided
            if on_progress:
                progress = PollProgress(
                    poll_number=poll_count,
                    elapsed_time=elapsed,
                    flights_so_far=len(all_flights),
                    programs_done=programs_done,
                    finished=finished,
                )
                on_progress(progress)
            
            # Exit if search is complete
            if finished:
                logger.info(
                    "AwardTool v2 search complete: task_id=%s flights=%d polls=%d",
                    task_id[:8], len(all_flights), poll_count
                )
                break
        
        # Wait before next poll (unless last iteration)
        if i < max_polls - 1 and not finished:
            await asyncio.sleep(config.poll_interval)
    
    elapsed = asyncio.get_event_loop().time() - start_time
    
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


def _flight_key(flight: Dict) -> str:
    """Generate a unique key for a flight to avoid duplicates."""
    # Use combination of route, date, program, and points
    origin = flight.get("origin", "")
    dest = flight.get("destination", "")
    program = flight.get("program_code", "")
    points = flight.get("award_points", "")
    flight_num = flight.get("flight_number", "")
    return f"{origin}:{dest}:{program}:{points}:{flight_num}"
```

### Phase 4: Main Search Function

```python
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
    Execute a complete award flight search using API v2.
    
    This is the main entry point that:
    1. Generates a unique task_id
    2. Primes the search across all programs (batched)
    3. Polls for results until complete or timeout
    4. Returns accumulated results
    
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
        AwardSearchResult with all accumulated flights
    """
    # Generate unique task ID for this search
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
    
    async with httpx.AsyncClient(
        http2=True,
        headers={"User-Agent": "Tripy/2.0 (+https://tripy.app)"},
    ) as client:
        
        # Phase 1: Prime the search
        primed_batches = await prime_search(client, config, task_id)
        
        if primed_batches == 0:
            logger.error(
                "AwardTool v2 search failed: no batches primed %s->%s",
                origin, destination
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
            )
        
        # Phase 2: Poll for results
        result = await poll_for_results(client, config, task_id, on_progress)
        
        logger.info(
            "AwardTool v2 search complete: %s->%s flights=%d time=%.1fs",
            origin, destination, len(result.flights), result.elapsed_time
        )
        
        return result
```

---

## Phase 5: Integration with Existing Code

Modify `backend/src/handlers/flights.py` to use the new API while maintaining backward compatibility.

### Option A: Feature Flag Migration (Recommended)

```python
# In flights.py, add feature flag

import os
USE_AWARDTOOL_V2 = os.getenv("USE_AWARDTOOL_V2", "false").lower() == "true"

async def _awardtool_realtime(origin, destination, date_str, cabins, pax, programs, client):
    """
    Fetch award flights - uses v2 API if enabled, otherwise v1.
    """
    if USE_AWARDTOOL_V2:
        return await _awardtool_realtime_v2(origin, destination, date_str, cabins, pax, programs, client)
    else:
        return await _awardtool_realtime_v1(origin, destination, date_str, cabins, pax, programs, client)


async def _awardtool_realtime_v2(origin, destination, date_str, cabins, pax, programs, client):
    """
    Fetch award flights using AwardTool API v2 (priming + polling).
    """
    from src.handlers.awardtool_v2 import search_award_flights_v2
    
    # Check cache first
    k = key_award(origin, destination, date_str, cabins, pax, programs)
    cached = get_json(k)
    if cached and cached.get("data") and not cached.get("error"):
        logger.debug("AwardTool v2 [%s]->[%s] date=%s: cache hit", origin, destination, date_str)
        return cached
    
    # Execute v2 search
    result = await search_award_flights_v2(
        origin=origin,
        destination=destination,
        date=date_str,
        cabins=cabins,
        pax=pax,
        programs=programs,
        api_key=AWARD_TOOL_API_KEY,
    )
    
    # Convert to v1 response format for compatibility
    body = _convert_v2_result_to_v1_format(result)
    
    # Cache successful results
    if body.get("data") and not body.get("error"):
        set_json(k, body, TTL_AWARD)
    
    return body


def _convert_v2_result_to_v1_format(result: "AwardSearchResult") -> Dict:
    """
    Convert v2 result format to v1 format for compatibility with existing code.
    
    V2 returns flights in `result.flights`, V1 expects `{"data": [...]}`.
    """
    # The v2 API returns flights with slightly different structure
    # Normalize to match what _merge_award_edges() expects
    normalized_data = []
    
    for flight in result.flights:
        normalized_data.append({
            "program_code": flight.get("program_code"),
            "award_points": flight.get("award_points") or flight.get("points"),
            "surcharge": flight.get("surcharge") or flight.get("taxes_and_fees"),
            "transfer_options": flight.get("transfer_options", []),
            "fare": {
                "products": [{
                    "origin": flight.get("origin"),
                    "destination": flight.get("destination"),
                    "flight_number": flight.get("flight_number"),
                    "departure_time": flight.get("departure_time"),
                    "arrival_time": flight.get("arrival_time"),
                    "operating_carrier": flight.get("operating_carrier"),
                    "travel_minutes": flight.get("duration") or flight.get("travel_minutes"),
                    "cabin": flight.get("cabin"),
                }],
                "travel_minutes_total": flight.get("duration") or flight.get("travel_minutes"),
            },
        })
    
    return {
        "data": normalized_data,
        "task_id": result.task_id,
        "programs_done": result.programs_done,
        "finished": result.finished,
    }
```

---

## Phase 6: Caching Strategy Updates

### New Cache Key Pattern

```python
# Add task_id to cache for resumable searches
def key_award_v2(o, d, date, cabins, pax, programs, task_id=None):
    pj = ",".join(sorted([p.upper() for p in programs]))
    cj = ",".join(cabins)
    base = f"award_v2:{o}:{d}:{date}:{cj}:{pax}:{pj}"
    if task_id:
        return f"{base}:task:{task_id}"
    return base

# Cache intermediate poll results for resume capability
def key_award_poll(task_id, poll_number):
    return f"award_poll:{task_id}:{poll_number}"
```

### Cache TTLs

| Cache Type | TTL | Rationale |
|------------|-----|-----------|
| Final result | 6 hours | Same as current |
| Task ID mapping | 10 minutes | Allow resume of interrupted search |
| Poll progress | 5 minutes | Short-lived, only for active searches |

---

## Phase 7: Program Batching Strategy

### Intelligent Batching by User's Points

Prioritize programs the user can actually use:

```python
def get_prioritized_program_batches(
    all_programs: List[str],
    user_banks: List[str],
    transfer_graph: Dict[str, Dict[str, float]],
    batch_size: int = 3,
) -> List[List[str]]:
    """
    Create program batches prioritized by user's transfer options.
    
    Programs the user can transfer to are searched first.
    """
    # Programs user can transfer to
    user_programs = set()
    for bank in user_banks:
        user_programs.update(transfer_graph.get(bank, {}).keys())
    
    # Split into priority tiers
    high_priority = [p for p in all_programs if p in user_programs]
    low_priority = [p for p in all_programs if p not in user_programs]
    
    # Create batches, high priority first
    ordered_programs = high_priority + low_priority
    batches = [
        ordered_programs[i:i + batch_size]
        for i in range(0, len(ordered_programs), batch_size)
    ]
    
    return batches
```

### Alliance-Based Batching

Group programs by alliance for similar availability:

```python
PROGRAM_BATCHES_BY_ALLIANCE = [
    # Star Alliance
    ["UA", "AC", "NH"],
    ["LH", "SQ", "TK"],
    # Oneworld
    ["AA", "BA", "CX"],
    ["QF", "AS", "QR"],
    # SkyTeam
    ["DL", "AF", "KL"],
    # Independent
    ["EK", "EY", "VS"],
    ["AV", "B6", "IB"],
]
```

---

## Phase 8: Error Handling

### Graceful Degradation

```python
async def search_with_fallback(origin, destination, date_str, cabins, pax, programs, client):
    """
    Search with automatic fallback from v2 to v1 on failure.
    """
    if USE_AWARDTOOL_V2:
        try:
            result = await _awardtool_realtime_v2(
                origin, destination, date_str, cabins, pax, programs, client
            )
            if result.get("data"):
                return result
            logger.warning("AwardTool v2 returned no data, falling back to v1")
        except Exception as e:
            logger.warning("AwardTool v2 failed, falling back to v1: %s", str(e))
    
    # Fallback to v1
    return await _awardtool_realtime_v1(
        origin, destination, date_str, cabins, pax, programs, client
    )
```

### Partial Results on Timeout

```python
# In poll_for_results(), when max_poll_time is reached:
if not finished:
    logger.warning(
        "AwardTool v2 poll timeout: returning partial results "
        "(%d flights from %d/%d programs)",
        len(all_flights), len(programs_done), len(config.programs)
    )
    # Still return what we have - partial data is better than no data
```

---

## Phase 9: Testing Strategy

### Unit Tests

```python
# tests/test_awardtool_v2.py

import pytest
from unittest.mock import AsyncMock, patch
from src.handlers.awardtool_v2 import (
    search_award_flights_v2,
    prime_search,
    poll_for_results,
)

@pytest.mark.asyncio
async def test_successful_search():
    """Test complete search flow with mocked responses."""
    with patch('httpx.AsyncClient') as mock_client:
        # Mock priming response
        mock_client.post.side_effect = [
            AsyncMock(status_code=200),  # Priming
            AsyncMock(status_code=200, json=lambda: {
                "result": [{"program_code": "UA", "award_points": 35000}],
                "finish": True,
                "program_done": ["UA"],
            }),  # Polling
        ]
        
        result = await search_award_flights_v2(
            origin="JFK",
            destination="CDG",
            date="2025-03-15",
            cabins=["Economy"],
            pax=1,
            programs=["UA"],
            api_key="test-key",
        )
        
        assert result.finished
        assert len(result.flights) == 1
        assert result.flights[0]["program_code"] == "UA"


@pytest.mark.asyncio
async def test_partial_results_on_timeout():
    """Test that partial results are returned on timeout."""
    # ... test implementation
```

### Integration Tests

```python
@pytest.mark.integration
@pytest.mark.asyncio
async def test_real_api_search():
    """Integration test with real API (requires API key)."""
    api_key = os.getenv("AWARD_TOOL_API_KEY")
    if not api_key:
        pytest.skip("AWARD_TOOL_API_KEY not set")
    
    result = await search_award_flights_v2(
        origin="JFK",
        destination="LHR",
        date="2025-06-15",
        cabins=["Business"],
        pax=1,
        programs=["UA", "BA"],
        api_key=api_key,
        max_poll_time=30,
    )
    
    assert result.task_id
    assert result.elapsed_time > 0
    # May or may not have flights depending on availability
```

---

## Phase 10: Monitoring & Observability

### Metrics to Track

```python
# Add to metrics collection
METRICS = {
    "awardtool_v2_search_total": Counter,      # Total searches initiated
    "awardtool_v2_search_success": Counter,    # Searches completed successfully
    "awardtool_v2_search_partial": Counter,    # Searches returned partial results
    "awardtool_v2_search_failed": Counter,     # Searches failed completely
    "awardtool_v2_poll_count": Histogram,      # Polls per search
    "awardtool_v2_search_duration": Histogram, # Time per search
    "awardtool_v2_flights_found": Histogram,   # Flights per search
}
```

### Logging

```python
# Structured logging for debugging
logger.info(
    "awardtool_v2_search",
    extra={
        "event": "search_complete",
        "origin": origin,
        "destination": destination,
        "task_id": task_id,
        "flights_found": len(result.flights),
        "programs_done": result.programs_done,
        "polls": result.total_polls,
        "elapsed_seconds": result.elapsed_time,
        "finished": result.finished,
    }
)
```

---

## Rollout Plan

### Stage 1: Development (1-2 days)
- [ ] Create `awardtool_v2.py` module
- [ ] Implement priming and polling functions
- [ ] Add unit tests

### Stage 2: Integration (1-2 days)
- [ ] Add feature flag `USE_AWARDTOOL_V2`
- [ ] Integrate with `flights.py`
- [ ] Add format conversion for compatibility
- [ ] Add integration tests

### Stage 3: Testing (2-3 days)
- [ ] Test with dummy mode
- [ ] Test with real API in staging
- [ ] Performance comparison (v1 vs v2)
- [ ] Verify caching behavior

### Stage 4: Gradual Rollout
- [ ] Enable for 10% of requests
- [ ] Monitor error rates and latency
- [ ] Enable for 50% of requests
- [ ] Full rollout with v1 fallback
- [ ] Remove v1 code after stabilization

---

## Configuration

### Environment Variables

```bash
# Enable v2 API
USE_AWARDTOOL_V2=true

# API Key (same as v1)
AWARD_TOOL_API_KEY=your-api-key

# Optional: Override defaults
AWARDTOOL_V2_POLL_INTERVAL=5
AWARDTOOL_V2_MAX_POLL_TIME=60
AWARDTOOL_V2_PROGRAM_BATCH_SIZE=3
```

---

## File Structure

```
backend/src/handlers/
├── flights.py              # Modified: Add v2 integration
├── awardtool_v2.py         # NEW: v2 API client
├── award_calendar.py       # Unchanged
├── serp_client.py          # Unchanged
└── awardtool_dummy.py      # Update for v2 format

tests/
├── test_awardtool_v2.py    # NEW: v2 unit tests
└── test_flights.py         # Update: v2 integration tests
```

---

## Summary

This implementation plan migrates Tripy to AwardTool API v2 with:

1. **Two-phase search** (priming + polling) for better reliability
2. **Progressive results** - return partial data on timeout
3. **Intelligent batching** - prioritize programs by user's points
4. **Feature flag rollout** - gradual migration with v1 fallback
5. **Full backward compatibility** - existing code continues to work

The key benefits are:
- No more hard timeouts losing all data
- Better UX with progressive loading
- More efficient API usage with proper task_id billing
- Cleaner separation of concerns with dedicated module
