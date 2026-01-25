# Tripy Backend: Itinerary Optimization System Documentation

## Overview

The Tripy backend uses **Integer Linear Programming (ILP)** with the **PuLP** library to solve a multi-objective optimization problem. The system maximizes travel value by finding the optimal combination of:
- Flight routes (using points or cash)
- Ground transportation (bus/car)
- Points transfer strategies
- Hotel accommodations (when included)

---

## Table of Contents

1. [Key Definitions: Departure, Arrival, Destination](#key-definitions-departure-arrival-destination)
2. [Transportation Mode Selection](#transportation-mode-selection-fly-vs-bus-vs-car)
3. [Hotel Booking Logic](#hotel-booking-logic)
4. [The ILP Optimization Algorithm](#the-ilp-optimization-algorithm)
5. [Edge Fetching and Data Sources](#edge-fetching-and-data-sources)
6. [Key Files Reference](#key-files-reference)

---

## Key Definitions: Departure, Arrival, Destination

### Departure (Start City)

The **origin airport** where the trip begins.

**Implementation:** `backend/src/services/itinerary_service.py` (lines 1472-1501)

**Logic for determining start city:**
1. Prefers explicit `isStart=True` flag on a destination
2. Falls back to the **first** `mustInclude` destination
3. Otherwise uses the first valid destination

**Key behavior:** The departure city gets **0 days** allocated (transit only, no overnight stay).

```python
# From itinerary_service.py
start_d = next((d for d in valid_destinations if d.get("isStart", False)), None)
if start_dest_name is None:
    if must_include:
        start_dest_name = must_include[0].get("name", "").strip()
    if start_dest_name is None and valid_destinations:
        start_dest_name = valid_destinations[0].get("name", "").strip()
```

### Arrival (End City)

The **final airport** where the trip ends.

**Implementation:** `backend/src/services/itinerary_service.py` (lines 1476-1501)

**Logic for determining end city:**
1. Prefers explicit `isEnd=True` flag
2. Falls back to the **last** `mustInclude` destination
3. Otherwise uses the last valid destination (or same as start for round trips)

**Key behavior:**
- If it's a return-to-origin trip (e.g., JFK → Paris → JFK), the end gets **0 days**
- If it's a one-way trip, the end destination gets stay days

### Destination (Stay Cities)

Cities where travelers **actually stay overnight** (not just transit through).

**Implementation:** `backend/src/services/itinerary_service.py` (lines 1970-2011)

```python
# NOTE: Day allocation logic:
# - Origin (path[0]) gets 0 days (departure only). Return-to-origin (path[-1]==path[0]) gets 0 days.
# - Stays = cities in path[1:] that are in city_codes OR the end when it's a real destination.
#   E.g. JFK→DOH→HKG with only HKG in city_codes: 9 days in HKG; Doha is transit (0 days).
# - Days are split evenly among stay cities, with remainder to the last.
```

**Example Trip: JFK → DOH → HKG (9-day trip)**

| City | Role | Days Allocated |
|------|------|----------------|
| JFK | Departure | 0 days |
| DOH | Transit (connection) | 0 days |
| HKG | Destination | 9 days |

### Summary Table

| Concept | Definition | Days Allocated |
|---------|------------|----------------|
| **Departure** | Origin airport where trip begins | 0 days (transit only) |
| **Arrival** | Final airport where trip ends | 0 days if round-trip; stay days if one-way |
| **Destination** | Cities where you overnight | Days split evenly from total trip length |
| **Transit** | Connection cities not in user's destination list | 0 days |

---

## Transportation Mode Selection (Fly vs. Bus vs. Car)

### Overview

The optimizer doesn't hardcode a transportation preference—it considers **all modes** simultaneously and lets the ILP algorithm pick the optimal one based on:
- Cash cost
- Time cost
- Points value (if applicable)

### All Modes as Graph Edges

All transportation options are represented as **edges in a graph**:

**Edge format:** `(origin, destination, mode)`

| Mode | Edge Key Example | Points Usable? |
|------|------------------|----------------|
| Flight (United) | `("JFK", "CDG", "UA")` | Yes |
| Flight (Delta) | `("JFK", "CDG", "DL")` | Yes |
| Bus | `("BOS", "JFK", "BUS")` | No |
| Car | `("BOS", "JFK", "CAR")` | No |

### Ground Transport Rules

**Implementation:** `backend/src/handlers/ground_transport.py` (lines 51-159)

Ground transport (bus/car) is only suggested when geographically feasible:

```python
# Critical Geographic Rules (from OpenAI prompt):
# - If the two places are on different continents separated by ocean: return null
# - If the two places are in different countries without direct land border: return null
# - For island nations (Japan, UK, Iceland) to/from other countries: return null
# - Only provide bus/car estimates if there's an actual road/land connection
# - Distance limits: bus typically only for <500 miles; car rental only for <800 miles same country
```

**Distance Limits:**
| Mode | Maximum Distance | Same Country Required? |
|------|------------------|----------------------|
| Bus | ~500 miles | No (land connection required) |
| Car | ~800 miles | Yes (typically) |

### How Mode is Determined

**Implementation:** `backend/src/handlers/ground_transport.py`

1. **OpenAI estimates** bus and car prices/durations based on the origin-destination pair
2. Geographic feasibility is checked first (same continent, land connection)
3. Returns `null` for impossible routes (e.g., bus from JFK to London)
4. If OpenAI unavailable, falls back to heuristic estimates (~$40 bus, ~$60 car for ~300 miles)

```python
def get_bus_and_car_options(origin, destination, date):
    """
    Returns [
        { "mode": "bus", "cash_cost": int, "time_cost": int (minutes), ... },
        { "mode": "car", "cash_cost": int, "time_cost": int (minutes), ... }
    ]
    Uses OpenAI when available; falls back to simple heuristics if not.
    """
```

### Small Airport Hub Fallback

For small regional airports without direct flights, the system automatically tries nearby hubs:

**Implementation:** `backend/src/services/itinerary_service.py` (lines 282-290)

```python
SMALL_AIRPORT_NEARBY_HUBS = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
    "SYR": ["BUF", "ALB", "EWR", "JFK"],           # Syracuse
}
```

**Example:** For ITH (Ithaca) to CDG (Paris):
1. No direct flights found from ITH
2. System tries: Ground transport ITH → SYR + Flight SYR → CDG
3. If that fails, tries: Ground transport ITH → JFK + Flight JFK → CDG

---

## Hotel Booking Logic

### The `includeHotels` Flag

Hotels are controlled by the `includeHotels` trip setting, which **defaults to `True`**.

**Implementation:** `backend/src/services/trip_service.py` and `backend/src/services/itinerary_service.py`

```python
# From itinerary_service.py (line 496)
include_hotels = trip.get("includeHotels", True) is not False
```

### When Hotels Are Fetched

Hotels are only fetched when **all conditions** are met:

**Implementation:** `backend/src/services/itinerary_service.py` (lines 1604-1624)

```python
if (
    trip.get("includeHotels", True)    # Must be True (default)
    and (end_dest_name or end_dest_code)  # Must have destination
    and start_date                         # Must have start date
    and end_date                           # Must have end date
    and travelers                          # Must have travelers
    and not city_codes                     # Only for simple trips (not multi-city)
):
    # Fetch hotels
```

**Key insight:** Hotels are currently only fetched for **simple A→B trips**, not multi-city itineraries.

### Cost Impact of Hotels

Hotels affect budget calculations in two ways:

**Implementation:** `backend/src/services/itinerary_service.py` (lines 497-498, 323-344)

| Setting | Cost per Day | Cost per City |
|---------|--------------|---------------|
| `includeHotels=True` (default) | $200/day | $300/city |
| `includeHotels=False` | $120/day | $200/city |

```python
base_cost_per_day = 200 if include_hotels else 120
base_cost_per_city = 300 if include_hotels else 200
```

### Hotel Data Sources

**Implementation:** `backend/src/handlers/hotels.py` and `backend/src/services/serp_api_functions.py`

Hotels are fetched from two sources and combined:

| Source | Data Provided | Points Support |
|--------|---------------|----------------|
| **AwardTool Hotel API** | Cash rates, points costs, surcharges | Yes (Hilton, IHG, Marriott, Hyatt) |
| **SerpAPI Google Hotels** | Cash rates only | No |

**Supported Hotel Programs:**
- `HH` - Hilton Honors
- `IHG` - IHG Rewards
- `MAR` - Marriott Bonvoy
- `HYATT` - World of Hyatt

### Hotel Out-of-Pocket Optimization

**Implementation:** `backend/src/services/serp_api_functions.py` (lines 413-522)

```python
def optimize_hotels_out_of_pocket(...):
    """
    Minimize hotel out-of-pocket: AwardTool (cash + points + surcharge) and SerpAPI (cash).
    Out-of-pocket = min(cash, surcharge) when points available, else cash.
    Returns: { best_by_cash, best_by_points, best_overall, options, ... }
    """
```

**Out-of-pocket calculation:**
- If points are available: `out_of_pocket = min(cash_rate, surcharge)`
- If no points: `out_of_pocket = cash_rate`

**Sorting priorities:**
| Selection | Sort Order |
|-----------|------------|
| Best by cash | Lowest `cash_cost`, then `out_of_pocket` |
| Best by points | Lowest `surcharge`, then `cash_cost` |
| Best overall | Lowest `out_of_pocket`, then `cash_cost` |

### Hotel Integration Summary

| Aspect | Behavior |
|--------|----------|
| Default | Hotels included (`includeHotels=True`) |
| When fetched | Simple trips only (not multi-city), with valid dates and destination |
| Cost impact | +$80/day, +$100/city when included |
| Optimization | Hotels are recommended separately from flight ILP optimization |
| Points programs | Hilton, IHG, Marriott, Hyatt via AwardTool |

---

## The ILP Optimization Algorithm

### Objective Function

**Implementation:** `backend/src/handlers/planTrip.py` (lines 53-56)

The optimizer **maximizes**:

```
W1 × points_value - W2 × total_cash - W3 × total_time
```

**Weight values:**
| Weight | Value | Purpose |
|--------|-------|---------|
| W1 | 10^6 | Points value (cash saved by using points) |
| W2 | 10^3 | Cash cost penalty |
| W3 | 1.0 | Time penalty |

**What this means:**
1. **Maximize points value** - Prefer using points when they save money
2. **Minimize cash spent** - After maximizing points value
3. **Minimize travel time** - As a tiebreaker

### Key Constraints

**Implementation:** `backend/src/handlers/planTrip.py`

| Constraint Type | Description | Lines |
|-----------------|-------------|-------|
| **Flow constraints** | Enter = exit for transit cities; exactly one path start→end | 231-247 |
| **MTZ subtour elimination** | Prevents cycles using Miller-Tucker-Zemlin constraints | 256-276 |
| **Payment constraints** | Exactly one payer per flight segment | 207-229 |
| **Transfer constraints** | Bank points transfer at defined ratios/blocks | 333-353 |
| **Budget constraints** | Total cash ≤ budget per payer | 374-344 |
| **Seat capacity** | Limited award seats per flight | Optional |

### Points Value Calculation

```python
def get_points_value(airline, edge):
    """
    Points value = (cash_cost - surcharge) / points_cost × 100
    Returns cents per point (CPP)
    """
    cash_saved = cash_cost - surcharge
    return (cash_saved * 100.0) / points_cost  # CPP
```

**Example:**
- Cash fare: $800
- Award: 35,000 miles + $50 surcharge
- Points value: ($800 - $50) / 35,000 × 100 = **2.14 CPP**

**Minimum threshold:** Only uses points if redemption value ≥ **1.0 cents per point** (in CPP mode)

---

## Edge Fetching and Data Sources

### Flight Search Priority

**Implementation:** `backend/src/services/itinerary_service.py` (lines 1327-1364)

```
1. AwardTool (award-first) → Best for points redemptions
2. SerpAPI (SERP-first) → Cash prices with award matching
3. SerpAPI-only → Cash prices only (fallback)
4. Add ground transport → Bus/car for the same route
5. Small airport hub → Ground to hub + flights from hub
```

### Caching Strategy

| Data Type | TTL | Cache Key Pattern |
|-----------|-----|-------------------|
| Award flights | 6 hours | `award:{origin}:{dest}:{date}:{cabins}:{pax}:{programs}` |
| SERP flights | 90 minutes | `serp:{origin}:{dest}:{date}:{class}:{stops}:{bags}:t{type}` |
| Panorama calendar | 24 hours | `pan:{origin}:{dest}` |
| Hotels | 6 hours | `hotel:{dest}:{checkin}:{checkout}:{programs}:{guests}:{class}` |
| Ground transport | 7 days | `ground:{origin}:{dest}` |

### Fallback Strategies

**Flight Search:**
```
Award-First → SERP-First → SERP-Only → Nearby Hub Search → AI Route Suggestions
```

**Itinerary Generation:**
```
ILP Optimization → Relaxed Budget Retry → Best-Effort Path → Simple Itineraries → Minimal Fallback
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/handlers/planTrip.py` | ILP optimization algorithm (PuLP) |
| `backend/src/handlers/ilp_adapter.py` | Transforms flight edges into ILP inputs |
| `backend/src/services/itinerary_service.py` | Orchestrates full itinerary generation flow |
| `backend/src/handlers/flights.py` | Main flight search (AwardTool + SerpAPI) |
| `backend/src/handlers/ground_transport.py` | Bus/car option estimation |
| `backend/src/handlers/hotels.py` | AwardTool Hotel API integration |
| `backend/src/services/serp_api_functions.py` | SerpAPI + hotel out-of-pocket optimization |
| `backend/src/utils/award_programs.py` | Transfer graph configuration |
| `backend/src/utils/cache_layer.py` | API response caching |

---

## Example End-to-End Flow

**User input:** 150,000 Chase points, trip JFK → Paris → Rome → JFK

1. **Load trip data:** dates, destinations, members, points balances
2. **Convert cities to codes:** Paris → CDG, Rome → FCO
3. **Fetch all edges in parallel:**
   - JFK → CDG: flights + bus/car
   - CDG → FCO: flights + bus/car
   - FCO → JFK: flights + bus/car
4. **Build ILP inputs:** edges, points balances, transfer graph
5. **Run optimization:** maximize `W1×points_value - W2×cash - W3×time`
6. **Build transfer tips:** which banks → which airlines, how many points
7. **Fetch hotels** (if simple trip with `includeHotels=True`)
8. **Save and return:** optimized path, payment modes, transfer tips, out-of-pocket costs

**Example outcome:**
- Use 90,000 miles (transferred to Air France + Delta) + $445 cash
- Value delivered: $2,800 in flights for $445 out-of-pocket (82% savings)

---

## Summary

| Component | How It Works |
|-----------|--------------|
| **Departure** | Origin airport (0 days, transit only) |
| **Arrival** | Final airport (0 days if round-trip, otherwise gets stay days) |
| **Destination** | Cities where you overnight (days allocated based on trip length) |
| **Flight selection** | AwardTool → SerpAPI → cash-only fallback |
| **Ground transport** | Only when geographically feasible (<500mi bus, <800mi car, land connection) |
| **Mode selection** | ILP optimizer chooses automatically based on cost + time + points value |
| **Hotels** | Fetched for simple trips when `includeHotels=True`; affects cost estimates |
| **Optimization** | Multi-objective ILP: maximize points value, minimize cash, minimize time |
