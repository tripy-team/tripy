# Tripy Backend: Award Point Flight Optimization System

## Overview

The Tripy backend is a **FastAPI-based travel optimization service** that helps users maximize the value of their credit card points and airline miles when booking flights. It accomplishes this by:

1. **Aggregating real-time flight data** from multiple sources (cash fares + award availability)
2. **Optimizing itineraries** using Integer Linear Programming (ILP) to find the best combination of cash and points payments
3. **Providing actionable transfer instructions** so users know exactly how to book their optimized trips

---

## Core API Integrations for Award Flights

The system uses two primary APIs to query flight availability and pricing:

### 1. SerpAPI (Google Flights) - Cash Fares

- **Purpose**: Real-time cash flight prices from Google Flights
- **Endpoint**: `https://serpapi.com/search.json` with `engine: google_flights`
- **Cache TTL**: 90 minutes
- **File**: `backend/src/handlers/flights.py`, `backend/src/handlers/serp_client.py`

```python
# Key parameters sent to SerpAPI
params = {
    "engine": "google_flights",
    "departure_id": "JFK",        # Origin airport
    "arrival_id": "CDG",          # Destination airport
    "outbound_date": "2025-03-15",
    "type": 2,                    # One-way flight
    "currency": "USD",
    "deep_search": True,          # More options
    "travel_class": 1,            # Economy
}
```

### 2. AwardTool API - Award Availability

- **Purpose**: Real-time award seat availability and points pricing from airline loyalty programs
- **Endpoints**:
  - `search_real_time` - Live award flight search
  - `panorama_calendar_data` - Award calendar for date flexibility
- **Cache TTL**: 6 hours (flights), 24 hours (calendar)
- **Files**: `backend/src/handlers/flights.py`, `backend/src/handlers/award_calendar.py`

```python
# Key parameters sent to AwardTool
payload = {
    "origin": "JFK",
    "destination": "CDG",
    "programs": ["UA", "DL", "AA", "AF", "BA"],  # Airline programs to search
    "cabins": ["Economy", "Business"],
    "date": "2025-03-15",
    "pax": "1",
    "api_key": AWARD_TOOL_API_KEY,
}
```

### Supported Airline Programs

| Region | Airlines |
|--------|----------|
| **US Majors** | UA (United), AA (American), DL (Delta) |
| **Other US** | AS (Alaska), B6 (JetBlue) |
| **North Atlantic** | AC (Air Canada), BA (British Airways), AF (Air France), KL (KLM) |
| **European** | LH (Lufthansa), LX (Swiss) |
| **Asian** | SQ (Singapore), CX (Cathay Pacific), NH (ANA), JL (JAL) |
| **Middle East** | EK (Emirates), QR (Qatar), EY (Etihad), TK (Turkish) |
| **Others** | AV (Avianca), IB (Iberia), QF (Qantas), VS (Virgin Atlantic) |

---

## The Flight Search Strategy

The system uses a **cascading strategy** to ensure comprehensive flight coverage:

```
Award-First Strategy (default):
1. AwardTool Panorama Calendar → identify best dates with availability
2. AwardTool Real-Time → get exact award prices for target date
3. SerpAPI Google Flights → get cash prices for the same routes
4. Merge: Award edges get priority, cash-only flights added as backup

Fallback Chain:
Award-First → SERP-First → SERP-Only → Nearby Hub Search → AI Route Suggestions
```

### Small Airport Handling

For **small airports** (like ITH - Ithaca), the system automatically:

1. Detects no direct flights
2. Finds nearby hub airports (SYR, BUF, JFK)
3. Adds ground transport edges (bus/car options)
4. Optimizes: small airport → hub → destination

```python
SMALL_AIRPORT_NEARBY_HUBS = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
    "SYR": ["BUF", "ALB", "EWR", "JFK"],           # Syracuse
}
```

---

## The ILP Optimization Algorithm

The heart of the system is in `backend/src/handlers/points_maximizer.py`, which uses **PuLP** (Integer Linear Programming) to solve the optimization problem.

### Objective Function

```
Maximize:
  W1 × points_value - W2 × cash_paid - W3 × time_penalty + W_benefit × bag_savings
```

Where:
- **W1 = 10^6** - Points value (cash saved by using points instead of paying cash)
- **W2 = 10^3** - Cash cost penalty  
- **W3 = 1.0** - Time penalty
- **W_benefit = 10^4** - Card benefit savings (e.g., free checked bags)

### Key Constraints

| Constraint Type | Description |
|----------------|-------------|
| **Path constraints** | Must start at origin, end at destination |
| **Flow conservation** | Enter = exit for transit cities |
| **Payment constraints** | Exactly one payer per flight segment |
| **Transfer constraints** | Bank points transfer to airlines at defined ratios |
| **Native points constraints** | Direct airline mile usage |
| **Budget constraints** | Cash budget per traveler |
| **Seat capacity constraints** | Limited award seats |

### Points Value Calculation

```python
def get_points_value(airline, edge):
    """
    Points value = (cash_cost - surcharge) / points_cost × 100
    Returns cents per point (CPP)
    """
    miles = get_miles(airline, edge)
    cash = cash_cost.get(edge, 0.0)
    surcharge = get_tax(airline, edge)
    cash_saved = cash - surcharge
    return (cash_saved * 100.0) / miles  # CPP
```

**Example:**
- Cash fare: $800
- Award: 35,000 miles + $50 surcharge
- Points value: ($800 - $50) / 35,000 × 100 = **2.14 CPP**

**Minimum threshold**: Only uses points if redemption value ≥ **1.0 cents per point**

---

## Transfer Graph: Bank → Airline Connections

The system models which bank points can transfer to which airlines in `backend/src/utils/award_programs.py`:

```python
DEFAULT_TRANSFER_GRAPH = {
    "amex": {"UA": 1.0, "AA": 1.0, "DL": 1.0, "AF": 1.0, ...},
    "chase": {"UA": 1.0, "BA": 1.0, "AF": 1.0, "SQ": 1.0, ...},
    "citi": {"AA": 1.0, "TK": 1.0, "QF": 1.0, ...},
    "capitalone": {"AF": 1.0, "BA": 1.0, "AV": 1.0, ...},
    "bilt": {"UA": 1.0, "AA": 1.0, "BA": 1.0, ...},
}
```

### Transfer Example

This allows the optimizer to determine the best transfer path:

1. **User has**: 100,000 Chase Ultimate Rewards
2. **Trip**: JFK → Paris (CDG)
3. **Options evaluated**: Chase → United, Chase → Air France, Chase → British Airways...
4. **Optimizer picks**: Chase → Air France Flying Blue (30,000 miles + $150) = **2.17 CPP**

---

## End-to-End Flow: Itinerary Generation

When you call `POST /itinerary/generate`, here's what happens:

### Step 1: Load Trip Data
```python
trip = trip_service.get_trip(trip_id)
destinations = destination_service.list_destinations(trip_id)
points_summary = points_service.trip_points_summary(trip_id)
```

### Step 2: Convert Cities to Airport Codes
```python
# "New York" → "JFK"
# "Paris (CDG,ORY)" → "CDG"
start_code = _normalize_city_to_code(start_dest_name)
```

### Step 3: Fetch Flight Edges (Parallel)
```python
# For each O-D pair, fetch award and cash flights in parallel
edges = await get_flights_award_first_with_points_async(origin, dest, points, filters)
```

### Step 4: Build ILP Inputs
```python
ilp_inputs = build_ilp_inputs_from_edges(
    edges_dict,
    travelers,
    start_city_by_trav,
    end_city_by_trav,
    user_points_by_trav,
    transfer_graph=DEFAULT_TRANSFER_GRAPH,
)
```

### Step 5: Run Optimization
```python
solution = plan_maximize_points_value(
    travelers, start_city, end_city, cities, edges,
    time_cost, cash_cost, airlines, award_points, ...
)
```

### Step 6: Build Transfer Tips
```python
transfer_tips = build_transfer_tips_from_solution(solution, edges_all)
```

### Step 7: Return Solution
Returns optimized path, payment modes, transfer tips, and out-of-pocket costs.

---

## Caching Strategy

The backend uses a caching layer (`backend/src/utils/cache_layer.py`) to reduce API calls:

| Data Type | TTL | Cache Key Pattern |
|-----------|-----|-------------------|
| Award flights | 6 hours | `award:{origin}:{dest}:{date}:{cabins}:{pax}:{programs}` |
| SERP flights | 90 minutes | `serp:{origin}:{dest}:{date}:{class}:{stops}:{bags}:t{type}` |
| Panorama calendar | 24 hours | `pan:{origin}:{dest}` |
| Hotels | 6 hours | `hotel:{dest}:{checkin}:{checkout}:{programs}:{guests}:{class}` |
| Ground transport | 7 days | `ground:{origin}:{dest}` |

---

## Fallback Strategies

The backend includes multiple fallback mechanisms to ensure users always get results:

### Flight Search Fallbacks
```
Award-First → SERP-First → SERP-Only → Nearby Hub Search → AI Route Suggestions
```

### Itinerary Generation Fallbacks
```
ILP Optimization → Relaxed Budget Retry → Best-Effort Path → Simple Itineraries → Minimal Fallback
```

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `backend/src/handlers/flights.py` | Main flight search logic (AwardTool + SerpAPI) |
| `backend/src/handlers/serp_client.py` | SerpAPI client for cash flights |
| `backend/src/handlers/award_calendar.py` | AwardTool Panorama calendar integration |
| `backend/src/handlers/points_maximizer.py` | ILP optimization algorithm |
| `backend/src/handlers/ilp_adapter.py` | Transforms flight edges into ILP inputs |
| `backend/src/services/itinerary_service.py` | Orchestrates the full itinerary generation flow |
| `backend/src/utils/award_programs.py` | Transfer graph configuration |
| `backend/src/utils/cache_layer.py` | API response caching |

---

## Grand Scheme: What This Accomplishes

The system solves a complex **multi-objective optimization problem** that would be nearly impossible for humans to solve manually:

| Challenge | Solution |
|-----------|----------|
| "Which flights have award availability?" | AwardTool real-time search across 22+ airlines |
| "What's the cash price for comparison?" | SerpAPI Google Flights integration |
| "Should I pay cash or use points?" | ILP optimizer with 1 CPP minimum threshold |
| "Which bank should I transfer from?" | Transfer graph optimization (5 banks → 22 airlines) |
| "What if my budget is too low?" | Automatic budget relaxation + best-effort fallback |
| "How do I actually book this?" | Detailed transfer tips with portal URLs and steps |

### Core Value Proposition

Transform scattered credit card points into **maximum travel value** by finding redemptions that save the most money compared to paying cash.

**Example outcome:**
- **User input**: 150,000 Chase points, trip JFK → Paris → Rome → JFK
- **Output**: Use 90,000 miles (transferred to Air France + Delta) + $445 cash
- **Value delivered**: $2,800 in flights for $445 out-of-pocket (82% savings)

---

## Environment Variables

```bash
# API Keys
SERPAPI_KEY=your_serpapi_key
AWARDTOOL_API_KEY=your_awardtool_key
OPENAI_API_KEY=your_openai_key

# AWS
AWS_REGION=us-east-1
COGNITO_USER_POOL_ID=us-east-1_xxxxx
COGNITO_CLIENT_ID=xxxxx

# CORS
CORS_ORIGINS=https://your-frontend.com,http://localhost:3000
```
