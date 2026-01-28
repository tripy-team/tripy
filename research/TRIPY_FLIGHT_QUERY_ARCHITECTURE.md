# Tripy Flight Query Architecture

This document details how Tripy currently queries flight information for both cash prices and award (points) availability.

---

## Overview

Tripy uses a **dual-source flight data architecture** that combines:

1. **AwardTool API** - Real-time award seat availability and points pricing
2. **SerpAPI (Google Flights)** - Cash flight prices for comparison

These two data sources are merged to create unified "flight edges" that the ILP optimizer uses to determine the best payment strategy (cash vs. points).

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User Request                                   │
│         (origin, destination, date, travelers, points balances)          │
└─────────────────────────────────┬───────────────────────────────────────┘
                                  │
                                  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Flight Search Strategy                            │
│    ┌──────────────────┐    ┌───────────────────┐    ┌────────────────┐  │
│    │   Award-First    │    │    SERP-First     │    │   SERP-Only    │  │
│    │    (default)     │    │    (fallback)     │    │   (fallback)   │  │
│    └────────┬─────────┘    └─────────┬─────────┘    └───────┬────────┘  │
└─────────────┼───────────────────────┼───────────────────────┼───────────┘
              │                       │                       │
              ▼                       ▼                       ▼
┌─────────────────────────┐  ┌─────────────────────┐  ┌──────────────────┐
│  1. Panorama Calendar   │  │  1. SerpAPI Call    │  │  SerpAPI Only    │
│  2. AwardTool Realtime  │  │  2. AwardTool Match │  │  (no awards)     │
│  3. SerpAPI Cash Prices │  └─────────────────────┘  └──────────────────┘
└─────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                          Merged Flight Edges                             │
│   { (origin, dest, flight_num): cash_cost, points_cost, surcharge, ... }│
└─────────────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                         ILP Optimizer (PuLP)                             │
│            Determines optimal cash vs. points strategy                   │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Data Source 1: AwardTool API

### Purpose
Fetches real-time award seat availability and points pricing across 22+ airline loyalty programs.

### Endpoints Used

| Endpoint | Purpose | Cache TTL |
|----------|---------|-----------|
| `search_real_time` | Live award flight search | 6 hours |
| `panorama_calendar_data` | Award availability calendar | 24 hours |

### Implementation Location
- `backend/src/handlers/flights.py` - Main flight fetching logic
- `backend/src/handlers/award_calendar.py` - Panorama calendar integration

### Request Flow

```python
# 1. Build payload
payload = {
    "origin": "JFK",
    "destination": "CDG",
    "programs": ["UA", "DL", "AA", "AF", "BA", ...],  # 22 programs
    "cabins": ["Economy", "Business"],
    "date": "2025-03-15",
    "pax": "1",
    "api_key": AWARD_TOOL_API_KEY,
}

# 2. Send request
POST https://www.awardtool-api.com/search_real_time
Content-Type: application/json

# 3. Parse response
{
    "data": [
        {
            "program_code": "UA",
            "award_points": 35000,
            "surcharge": 50.00,
            "transfer_options": ["chase", "bilt"],
            "fare": {
                "products": [
                    {
                        "origin": "JFK",
                        "destination": "CDG",
                        "flight_number": "UA123",
                        "departure_time": "2025-03-15T19:30:00",
                        "arrival_time": "2025-03-16T08:45:00",
                        "operating_carrier": "UA"
                    }
                ]
            }
        },
        ...
    ]
}
```

### Supported Programs (22 Airlines)

| Category | Programs |
|----------|----------|
| **US Majors** | UA (United), AA (American), DL (Delta) |
| **US Others** | AS (Alaska), B6 (JetBlue) |
| **North Atlantic** | AC (Air Canada), BA (British Airways), AF (Air France), KL (KLM) |
| **European** | LH (Lufthansa), LX (Swiss) |
| **Asia-Pacific** | SQ (Singapore), CX (Cathay), NH (ANA), JL (JAL) |
| **Middle East** | EK (Emirates), QR (Qatar), EY (Etihad), TK (Turkish) |
| **Other** | AV (Avianca), IB (Iberia), QF (Qantas), VS (Virgin Atlantic) |

### Retry Logic

If the initial request with all 22 programs fails or returns no data, the system retries with a reduced set of common programs:

```python
common_programs = ["DL", "AA", "UA", "AS", "BA", "VS", "AF", "NH", "CX", "SQ"]
```

---

## Data Source 2: Panorama Calendar (AwardTool)

### Purpose
Identifies dates with the best award availability before making the real-time search.

### Implementation

```python
# Fetch calendar matrix
GET https://www.awardtool-api.com/panorama/panorama_calendar_data
{
    "id": "JFK-CDG",
    "api_key": AWARD_TOOL_API_KEY
}

# Response contains availability per date/cabin
{
    "data": [
        {
            "date": "2025-03-15",
            "program": "UA",
            "points": {
                "y": 35000,    # economy
                "w": 55000,    # premium economy
                "j": 70000,    # business
                "f": 110000,   # first
                "tax": {"y": 50, "j": 150, ...},
                "ss": {"y": true, "j": true, ...}  # availability flag
            }
        }
    ]
}
```

### Usage in Search Strategy

```python
# Get top dates with best availability for user's cabin
top_dates = best_dates_by_cabin(calendar_matrix, "business", top_k=2)
# Returns: ["2025-03-15", "2025-03-18"]

# Search both the requested date AND the best dates from panorama
dates_to_search = [user_requested_date] + top_dates
```

---

## Data Source 3: SerpAPI (Google Flights)

### Purpose
Provides cash flight prices from Google Flights for:
1. Comparing award value vs. paying cash
2. Filling in flights that don't have award availability

### Implementation Location
- `backend/src/handlers/flights.py` - Async SERP route fetching
- `backend/src/handlers/serp_client.py` - Direct SERP client

### Request Flow

```python
# Build request params
params = {
    "engine": "google_flights",
    "api_key": SERPAPI_KEY,
    "type": 2,  # One-way
    "currency": "USD",
    "deep_search": True,
    "departure_id": "JFK",
    "arrival_id": "CDG",
    "outbound_date": "2025-03-15",
    "travel_class": 3,  # 1=Economy, 2=Premium, 3=Business, 4=First
}

# Send request
GET https://serpapi.com/search.json

# Response
{
    "best_flights": [...],
    "other_flights": [...],
    "search_metadata": {"status": "Success"}
}
```

### Flight Data Extracted

```python
{
    "cash_cost": 850.00,
    "time_cost": 420,  # minutes
    "departure_time": "2025-03-15T19:30:00",
    "arrival_time": "2025-03-16T08:45:00"
}
```

---

## Search Strategies

Tripy implements three search strategies with automatic fallback:

### Strategy 1: Award-First (Default)

**Best for:** Users with points who want to maximize award value

```
1. Panorama Calendar → identify best dates with availability
2. AwardTool Real-Time → get exact award prices for target dates
3. SerpAPI → get cash prices for the same routes
4. Merge: Award edges get priority, cash-only flights added as backup
```

**Implementation:** `get_flights_award_first_with_points_async()`

### Strategy 2: SERP-First

**Best for:** When award-first returns limited options

```
1. SerpAPI → broad cash flight search
2. AwardTool → match award options to found cash flights
3. Merge: SERP legs primary, annotated with available awards
```

**Implementation:** `get_flights_serp_first_with_points_async()`

### Strategy 3: SERP-Only (Fallback)

**Best for:** When no award availability exists on a route

```
1. SerpAPI only → get all cash flight options
2. Return as cash-only edges (no points data)
```

**Implementation:** `get_flights_serp_only()`

---

## Edge Data Structure

After merging, each flight edge contains:

```python
edges[(origin, destination, flight_number)] = {
    # Cash pricing
    "cash_cost": 850.00,           # USD from SerpAPI
    
    # Award pricing
    "points_cost": 35000,          # Miles required
    "points_program": "UA",        # Which program to book through
    "points_surcharge": 50.00,     # Taxes/fees for award
    "transfer_partners": ["chase", "bilt"],  # Banks that transfer here
    
    # Flight details
    "time_cost": 420,              # Duration in minutes
    "departure_time": "2025-03-15T19:30:00",
    "arrival_time": "2025-03-16T08:45:00",
    "operating_airline": "UA",
    
    # Metadata
    "award_from_different_flight": False  # True if award is O-D match (not exact flight)
}
```

---

## Merging Logic

### Award-First Merge

```python
# 1. Process all award edges first
for key, info in award_edges.items():
    dep, arr, fn = key
    
    # Find matching cash price (exact flight or best O-D)
    cash_blob = serp_map.get(key) or best_cash_by_od.get((dep, arr))
    
    edges[key] = {
        "cash_cost": cash_blob.get("cash_cost"),
        "points_cost": info.get("award_points"),
        "points_program": info.get("program_code"),
        ...
    }

# 2. Add extra cash-only legs (up to 12)
for key, cash_blob in serp_map.items():
    if key not in edges:
        # Attach best award option for this O-D pair if available
        best_award = best_award_by_od.get((dep, arr))
        edges[key] = {
            "cash_cost": cash_blob.get("cash_cost"),
            "points_cost": best_award.get("award_points") if best_award else None,
            ...
        }
```

### O-D Fallback Matching

When an exact flight number match isn't found, the system finds the best option by origin-destination pair:

```python
# Best award by O-D (lowest points)
best_award_by_od = {}
for (dep, arr, fn), info in award_edges.items():
    if pts < best_award_by_od.get((dep, arr), {}).get("award_points", inf):
        best_award_by_od[(dep, arr)] = info

# Best cash by O-D (lowest price)
best_cash_by_od = {}
for (dep, arr, fn), info in serp_map.items():
    if cash < best_cash_by_od.get((dep, arr), {}).get("cash_cost", inf):
        best_cash_by_od[(dep, arr)] = info
```

---

## Caching Layer

Tripy implements caching to reduce API costs and improve response times.

### Cache Configuration

| Data Type | Cache Key Pattern | TTL |
|-----------|-------------------|-----|
| Award flights | `award:{origin}:{dest}:{date}:{cabins}:{pax}:{programs}` | 6 hours |
| Panorama calendar | `pan:{origin}:{dest}` | 24 hours |
| SERP flights | `serp:{origin}:{dest}:{date}:{class}:{stops}:{bags}:t{type}` | 90 minutes |

### Cache Backend

```python
# Primary: Redis (if REDIS_URL is set)
_redis = redis.Redis.from_url(REDIS_URL)

# Fallback: In-memory dict with TTL
_mem_cache = {}
```

### Cache Behavior

- **On hit:** Return cached data immediately
- **On miss:** Fetch from API, cache result, return
- **Error responses:** NOT cached (only cache successful responses with data)

---

## Transfer Graph

The system knows which bank points can transfer to which airline programs:

### Supported Banks

| Bank | Transfer Partners |
|------|-------------------|
| **Amex** | DL, BA, AF, VS, SQ, AV, IB, CX, EK, EY, QR, NH, AC, JL, QF, KL, AS |
| **Chase** | UA, BA, AF, VS, SQ, IB, AC, KL, JL, EK, AS |
| **Citi** | AA, TK, QF, VS, SQ, EY, AF, CX, EK, QR, AV, TG, JL, AC |
| **Capital One** | AF, BA (0.75:1), AV, SQ, EK, EY, QF, QR, VS, TK, CX, FJ, TP, AS |
| **Bilt** | UA, AA, BA, AF, VS, AV, IB, CX, EK, EY, AC, AS, TK, TP |

### Transfer Ratio

Most transfers are 1:1, but some have different ratios:
- Capital One → BA: 0.75:1 (you lose 25%)

---

## Points Value Calculation

The ILP optimizer uses Cents Per Point (CPP) to determine value:

```python
CPP = (cash_cost - surcharge) / points_cost × 100

# Example:
# Cash fare: $850
# Award: 35,000 miles + $50 surcharge
# CPP = ($850 - $50) / 35,000 × 100 = 2.29 cpp
```

### Program-Specific Thresholds

Different programs have different minimum CPP thresholds:

| Category | Programs | Min CPP |
|----------|----------|---------|
| Premium Long-haul | SQ, NH | 1.5 |
| US Domestic | UA, AA, DL | 1.0 |
| High Surcharge | BA, LH, LX | 1.6-1.8 |
| Middle East | EK, QR, EY | 1.2-1.3 |

---

## Dummy Mode

For development/testing, Tripy supports a dummy mode that returns mock data:

```python
if is_awardtool_dummy_mode():
    from src.handlers.awardtool_dummy import generate_dummy_flight_data
    return generate_dummy_flight_data(origin, destination, date, cabins, programs, pax)
```

---

## Request Timeouts

| Operation | Connect | Read | Write | Pool |
|-----------|---------|------|-------|------|
| AwardTool | 5s | 25s | 5s | 20s |
| SerpAPI | 5s | 25s | 5s | 20s |
| Panorama Calendar | 5s | 20s | 5s | 5s |

---

## Error Handling

### AwardTool Errors

```python
try:
    response = await client.post(url, json=payload, timeout=TIMEOUT)
    response.raise_for_status()
    return response.json()
except httpx.HTTPStatusError as e:
    logger.warning(f"AwardTool HTTP {e.response.status_code}")
    return {"error": str(e), "data": []}
except Exception as e:
    return {"error": str(e), "data": []}
```

### Fallback Chain

```
Award-First → SERP-First → SERP-Only → Empty edges
```

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/src/handlers/flights.py` | Main flight search orchestration |
| `backend/src/handlers/serp_client.py` | SerpAPI client for cash prices |
| `backend/src/handlers/award_calendar.py` | AwardTool Panorama calendar |
| `backend/src/utils/award_programs.py` | Transfer graph and program config |
| `backend/src/utils/cache_layer.py` | Redis/memory caching |
| `backend/src/handlers/points_maximizer.py` | ILP optimization |

---

## Summary

Tripy's flight query architecture:

1. **Prioritizes award flights** through AwardTool's real-time search
2. **Uses panorama calendar** to find dates with best availability
3. **Enriches with cash prices** from Google Flights via SerpAPI
4. **Merges data intelligently** with O-D fallback matching
5. **Caches aggressively** to minimize API costs (6h awards, 90m cash)
6. **Falls back gracefully** from award-first → serp-first → serp-only

This dual-source approach ensures users always see the best redemption options while having cash alternatives for comparison.
