# Tripy Backend Implementation Guide

## Overview

Tripy is a travel planning application that optimizes itineraries to maximize the value of credit card points and airline miles. The backend is built with **FastAPI** and uses **AWS DynamoDB** for data persistence, integrating with multiple external APIs to provide real-time flight and hotel pricing.

## Table of Contents

1. [Architecture Overview](#architecture-overview)
2. [Core Optimization Algorithm](#core-optimization-algorithm)
3. [External API Integrations](#external-api-integrations)
4. [API Endpoints](#api-endpoints)
5. [Data Models](#data-models)
6. [Caching Strategy](#caching-strategy)
7. [Example API Responses](#example-api-responses)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Frontend (React)                               │
└────────────────────────────────┬───────────────────────────────────────────┘
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         FastAPI Backend (app.py)                            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │   Auth      │  │   Trips     │  │ Itinerary   │  │   Points    │        │
│  │  Endpoints  │  │  Endpoints  │  │  Endpoints  │  │  Endpoints  │        │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘        │
└─────────┼────────────────┼────────────────┼────────────────┼───────────────┘
          │                │                │                │
          ▼                ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Services Layer                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ auth_service │  │ trip_service │  │ itinerary_   │  │ points_      │     │
│  │              │  │              │  │ service      │  │ service      │     │
│  └──────────────┘  └──────────────┘  └──────┬───────┘  └──────────────┘     │
└──────────────────────────────────────────────┼──────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Handlers Layer                                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ flights.py   │  │ hotels.py    │  │ points_      │  │ ilp_adapter  │     │
│  │ (SERP +      │  │ (AwardTool)  │  │ maximizer.py │  │ .py          │     │
│  │  AwardTool)  │  │              │  │ (ILP Solver) │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          External APIs                                       │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ SerpAPI      │  │ AwardTool    │  │ OpenAI       │  │ AWS Cognito  │     │
│  │ (Cash Fares) │  │ (Award Fares)│  │ (AI Tips)    │  │ (Auth)       │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
                                               │
                                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          Data Layer                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │ DynamoDB     │  │ Redis Cache  │  │ S3 (Images)  │  │ CSV Files    │     │
│  │ (Trips,      │  │ (API Cache)  │  │              │  │ (Airports)   │     │
│  │  Points...)  │  │              │  │              │  │              │     │
│  └──────────────┘  └──────────────┘  └──────────────┘  └──────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Core Optimization Algorithm

### What It Optimizes

The backend's primary value proposition is **maximizing the cash value of travel points**. The optimization algorithm:

1. **Minimizes out-of-pocket costs** - Compares cash prices vs. points + surcharge
2. **Maximizes cents-per-point (CPP)** - Only uses points when redemption value exceeds a threshold
3. **Considers transfer partners** - Routes points through bank → airline transfers optimally
4. **Handles multi-city itineraries** - Optimizes visit order for cost efficiency
5. **Supports group travel** - Multiple travelers with different point balances

### The ILP (Integer Linear Programming) Solver

Located in `src/handlers/points_maximizer.py`, the optimization uses PuLP to solve:

```
Maximize:
  W1 × points_value - W2 × cash_paid - W3 × time_penalty + W_benefit × bag_savings

Subject to:
  - Path constraints (start → cities → end)
  - Flow conservation (enter = exit for transit cities)
  - Payment constraints (exactly one payer per edge)
  - Transfer constraints (bank points → airline miles)
  - Native points constraints (direct airline mile usage)
  - Budget constraints (cash budget per traveler)
  - Seat capacity constraints
```

**Objective Weights:**
- `W1 = 10^6` - Points value (cash saved by using points)
- `W2 = 10^3` - Cash cost penalty
- `W3 = 1.0` - Time penalty
- `W_benefit = 10^4` - Card benefit savings (e.g., free checked bags)

**Minimum CPP Threshold:** Only uses points if value ≥ 1.0 cent per point

### How It Works Step-by-Step

1. **Load Trip Data**
   ```python
   trip = trip_service.get_trip(trip_id)
   destinations = destination_service.list_destinations(trip_id)
   points_summary = points_service.trip_points_summary(trip_id)
   ```

2. **Convert Cities to Airport Codes**
   ```python
   # "New York" → "JFK"
   # "Paris (CDG,ORY)" → "CDG"
   start_code = _normalize_city_to_code(start_dest_name)
   ```

3. **Fetch Flight Edges (Parallel)**
   ```python
   # For each O-D pair, fetch award and cash flights in parallel
   edges = await get_flights_award_first_with_points_async(origin, dest, points, filters)
   ```

4. **Build ILP Inputs**
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

5. **Solve Optimization**
   ```python
   solution = plan_maximize_points_value(
       travelers, start_city, end_city, cities, edges,
       time_cost, cash_cost, airlines, award_points, ...
   )
   ```

6. **Build Transfer Tips**
   ```python
   transfer_tips = build_transfer_tips_from_solution(solution, edges_all)
   ```

### Transfer Graph

The `DEFAULT_TRANSFER_GRAPH` defines which bank points can transfer to which airlines:

```python
# Banks: amex, chase, citi, capitalone, bilt
# Airlines: UA, AA, DL, AS, B6, AC, BA, AF, KL, LH, LX, SQ, CX, NH, JL, EK, QR, EY, TK, AV, IB, QF, VS

DEFAULT_TRANSFER_GRAPH = {
    "amex": {"UA": 1.0, "AA": 1.0, "DL": 1.0, ...},
    "chase": {"UA": 1.0, "AA": 1.0, "DL": 1.0, ...},
    ...
}
```

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

---

## External API Integrations

### 1. SerpAPI (Google Flights)

**Purpose:** Real-time cash flight prices

**Endpoints Used:**
- `google_flights` - Flight search
- `google_flights_autocomplete` - Destination suggestions
- `google_hotels` - Hotel cash prices

**Example Request:**
```python
params = {
    "engine": "google_flights",
    "departure_id": "JFK",
    "arrival_id": "CDG",
    "outbound_date": "2025-03-15",
    "type": 2,  # One-way
    "currency": "USD",
    "travel_class": 1,  # Economy
    "api_key": SERPAPI_KEY,
}
```

### 2. AwardTool API

**Purpose:** Real-time award availability and pricing

**Endpoints:**
- `search_real_time` - Award flights
- `search_hotel` - Award hotels
- `panorama_calendar_data` - Award calendar for date flexibility

**Example Request:**
```python
payload = {
    "origin": "JFK",
    "destination": "CDG",
    "programs": ["UA", "DL", "AA", "AF"],
    "cabins": ["Economy", "Business"],
    "date": "2025-03-15",
    "pax": "1",
    "api_key": AWARD_TOOL_API_KEY,
}
```

**Response Structure:**
```json
{
  "status": 200,
  "data": [
    {
      "award_points": 30000,
      "surcharge": 150.00,
      "program_code": "AF",
      "cabin_type": "Economy",
      "fare": {
        "products": [
          {
            "origin": "JFK",
            "destination": "CDG",
            "flight_number": "AF007",
            "operating_carrier": "AF",
            "departure_time": "18:30",
            "arrival_time": "07:45+1"
          }
        ]
      }
    }
  ]
}
```

### 3. OpenAI

**Purpose:** AI-powered features

**Uses:**
- `extract_trip_info_with_openai` - Parse natural language trip descriptions
- `suggest_routes_for_remote_or_small_cities` - Suggest routes when no flight data
- `get_itinerary_smart_tips` - Travel tips and advice
- Ground transport estimates (bus/car between cities)

### 4. AWS Cognito

**Purpose:** User authentication

**Operations:**
- Sign up / Sign in
- Token refresh
- Password reset
- Email verification

---

## API Endpoints

### Authentication (No auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/auth/login` | POST | Login with email/password |
| `/auth/signup` | POST | Create new account |
| `/auth/confirm` | POST | Confirm email with code |
| `/auth/refresh` | POST | Refresh access token |
| `/auth/forgot-password` | POST | Request password reset |
| `/auth/confirm-forgot-password` | POST | Reset password with code |

### Trips (Auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/trips` | POST | Create new trip |
| `/trips` | GET | List user's trips |
| `/trips/get` | POST | Get trip by ID |
| `/trips/delete` | POST | Delete trip |
| `/trips/invite` | POST | Get invite code |
| `/trips/join` | POST | Join trip with invite code |
| `/trips/members` | POST | List trip members |

### Destinations (Auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/destinations/add` | POST | Add destination to trip |
| `/destinations/list` | POST | List trip destinations |

### Points (Auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/points/upsert` | POST | Add/update points balance |
| `/points/summary` | POST | Get points summary with valuations |
| `/points/valuations` | GET | Get TPG point valuations |

### Itinerary (Auth required)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/itinerary/generate` | POST | Generate optimized itinerary |
| `/itinerary/get` | POST | Get saved itinerary |

### Search (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/cities/search` | GET/POST | Search cities by name |
| `/api/airports/autocomplete` | GET | Airport autocomplete |
| `/api/destinations/autocomplete` | GET | Destination autocomplete |
| `/api/locations/autocomplete` | GET | Unified location search |
| `/api/locations/{city_id}/airports` | GET | Nearby airports |

### Optimization (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/itinerary/optimize-out-of-pocket` | POST | Optimize round-trip for lowest cost |
| `/hotels/search` | POST | Search award hotels |
| `/hotels/optimize-out-of-pocket` | POST | Optimize hotel for lowest cost |

### Images (Public)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/images/city/{city_name}` | GET | Get city images |
| `/images/city/{city_name}/hero` | GET | Get hero image |
| `/images/city/{city_name}/srcset` | GET | Get responsive srcset |

---

## Data Models

### Trip

```python
{
    "tripId": "uuid-string",
    "createdBy": "user-id",
    "title": "Europe Adventure",
    "startDate": "2025-03-15",
    "endDate": "2025-03-25",
    "includeHotels": True,
    "maxBudget": 3000,
    "durationDays": 10,
    "inviteCode": "ABC123",
    "createdAt": "2025-01-15T10:00:00Z",
    "updatedAt": "2025-01-15T10:00:00Z"
}
```

### Destination

```python
{
    "tripId": "trip-uuid",
    "destinationId": "dest-uuid",
    "name": "Paris (CDG,ORY)",
    "mustInclude": True,   # True = origin/destination, False = visiting city
    "excluded": False,
    "isStart": True,       # Starting point
    "isEnd": False,        # Ending point
    "addedBy": "user-id"
}
```

### Points

```python
{
    "tripId": "trip-uuid",
    "userProgram": "user-id#chase",
    "userId": "user-id",
    "program": "chase",  # or "UA", "DL", etc.
    "balance": 150000,
    "source": "manual"
}
```

### Itinerary Item (Path)

```python
{
    "tripId": "trip-uuid",
    "itemId": "path_user-id",
    "type": "path",
    "travelerId": "user-id",
    "path": ["JFK", "CDG", "FCO", "JFK"],
    "route": ["JFK", "CDG", "FCO", "JFK"],
    "cities": [
        {"name": "CDG", "days": 4},
        {"name": "FCO", "days": 5}
    ],
    "totalCost": 450,
    "pointsCost": 60000,
    "name": "Optimized route"
}
```

### Payment Record

```python
{
    "edge": ["JFK", "CDG", "AF007"],
    "type": "points",  # or "cash"
    "payer": "user-id",
    "via": {
        "source": "chase",
        "airline": "AF"
    },
    "miles": 30000,
    "surcharge": 150.00,
    "points_value": 650.00,  # Cash saved
    "cents_per_point": 2.17
}
```

### Transfer Tip

```python
{
    "from_program": "Chase Ultimate Rewards",
    "to_program": "Air France / KLM Flying Blue",
    "best_for": "JFK→CDG",
    "route_segment": "JFK→CDG",
    "departure": "JFK",
    "arrival": "CDG",
    "points": 30000,
    "surcharge": 150.00,
    "cents_per_point": 2.17,
    "points_value": 650.00,
    "booking_airline": "AF",
    "booking_airline_name": "Air France / KLM Flying Blue",
    "transfer_needed": True,
    "transfer_portal_url": "https://www.chase.com/ultimate-rewards",
    "transfer_time": "instant",
    "transfer_ratio": "1:1",
    "booking_url": "https://www.airfrance.com/",
    "transfer_steps": [
        "1. Visit Chase Ultimate Rewards portal",
        "2. Navigate to 'Transfer Points'",
        "3. Select Air France / KLM Flying Blue",
        "4. Enter your Flying Blue number",
        "5. Transfer 30,000 points (1:1 ratio, instant)",
        "6. Book on airfrance.com",
        "7. Search JFK to CDG",
        "8. Book using 30,000 miles + ~$150 taxes"
    ]
}
```

---

## Caching Strategy

The backend uses a caching layer (`src/utils/cache_layer.py`) to reduce API calls:

| Data Type | TTL | Cache Key Pattern |
|-----------|-----|-------------------|
| Award flights | 6 hours | `award:{origin}:{dest}:{date}:{cabins}:{pax}:{programs}` |
| SERP flights | 90 minutes | `serp:{origin}:{dest}:{date}:{class}:{stops}:{bags}:t{type}` |
| Panorama calendar | 24 hours | `pan:{origin}:{dest}` |
| Hotels | 6 hours | `hotel:{dest}:{checkin}:{checkout}:{programs}:{guests}:{class}` |
| Ground transport | 7 days | `ground:{origin}:{dest}` |

---

## Example API Responses

### POST /itinerary/generate

**Request:**
```json
{
    "trip_id": "abc123-def456"
}
```

**Response (Successful Optimization):**
```json
{
    "status": "Optimal",
    "solution": {
        "path": {
            "user-123": ["JFK", "CDG", "FCO", "JFK"]
        },
        "edges": {
            "user-123": [
                ["JFK", "CDG", "AF007"],
                ["CDG", "FCO", "AF1234"],
                ["FCO", "JFK", "DL456"]
            ]
        },
        "pay_mode": {
            "user-123": [
                {
                    "edge": ["JFK", "CDG", "AF007"],
                    "type": "points",
                    "payer": "user-123",
                    "via": {"source": "chase", "airline": "AF"},
                    "miles": 30000,
                    "surcharge": 150.00,
                    "points_value": 650.00,
                    "cents_per_point": 2.17
                },
                {
                    "edge": ["CDG", "FCO", "AF1234"],
                    "type": "cash",
                    "payer": "user-123",
                    "fare": 89.00
                },
                {
                    "edge": ["FCO", "JFK", "DL456"],
                    "type": "points",
                    "payer": "user-123",
                    "via": {"native": "DL"},
                    "miles": 45000,
                    "surcharge": 5.60,
                    "points_value": 394.40,
                    "cents_per_point": 0.88
                }
            ]
        },
        "totals": {
            "airline_points": 75000,
            "cash": 244.60,
            "time": 1140,
            "points_value": 1044.40,
            "transfers": {
                "user-123": {
                    "chase": {
                        "AF": {
                            "blocks": 30,
                            "source_points": 30000,
                            "delivered_airline_points": 30000
                        }
                    }
                }
            },
            "native_used": {
                "user-123": {
                    "DL": 45000
                }
            }
        }
    },
    "items": [
        {
            "tripId": "abc123-def456",
            "itemId": "path_user-123",
            "type": "path",
            "travelerId": "user-123",
            "path": ["JFK", "CDG", "FCO", "JFK"],
            "route": ["JFK", "CDG", "FCO", "JFK"],
            "cities": [
                {"name": "CDG", "days": 4},
                {"name": "FCO", "days": 5}
            ],
            "totalCost": 245,
            "pointsCost": 75000,
            "name": "Optimized route"
        },
        {
            "tripId": "abc123-def456",
            "itemId": "itinerary_smart_tips",
            "type": "itinerary_smart_tips",
            "transfer_tips": [
                {
                    "from_program": "Chase Ultimate Rewards",
                    "to_program": "Air France / KLM Flying Blue",
                    "best_for": "JFK→CDG",
                    "points": 30000,
                    "surcharge": 150.00,
                    "cents_per_point": 2.17,
                    "transfer_needed": true,
                    "transfer_steps": ["..."]
                }
            ]
        }
    ],
    "out_of_pocket": {
        "best_by_cash": {"price": 1200, "flights": [...]},
        "best_by_surcharge": {"price": 800, "surcharge": 250, "points": 60000},
        "best_overall": {"price": 800, "out_of_pocket": 250}
    }
}
```

### POST /points/summary

**Request:**
```json
{
    "trip_id": "abc123-def456"
}
```

**Response:**
```json
{
    "tripId": "abc123-def456",
    "totalPoints": 275000,
    "displayTotalPoints": "275,000",
    "totalValue": 4125.00,
    "displayTotalValue": "$4,125.00",
    "items": [
        {
            "tripId": "abc123-def456",
            "userId": "user-123",
            "program": "chase",
            "balance": 150000,
            "centsPerPoint": 1.5,
            "value": 2250.00,
            "displayBalance": "150,000",
            "displayValue": "$2,250.00",
            "displayCPP": "1.5¢",
            "programDisplayName": "Chase Ultimate Rewards",
            "category": "bank",
            "transferPartners": ["UA", "BA", "AF", "IB", "VS", "SQ", "AV"]
        },
        {
            "tripId": "abc123-def456",
            "userId": "user-123",
            "program": "DL",
            "balance": 125000,
            "centsPerPoint": 1.5,
            "value": 1875.00,
            "displayBalance": "125,000",
            "displayValue": "$1,875.00",
            "displayCPP": "1.5¢",
            "programDisplayName": "Delta SkyMiles",
            "category": "airline",
            "transferPartners": []
        }
    ],
    "byCategory": {
        "bank": [{"program": "chase", "balance": 150000, ...}],
        "airline": [{"program": "DL", "balance": 125000, ...}],
        "hotel": []
    },
    "recommendations": [
        {
            "fromProgram": "Chase Ultimate Rewards",
            "fromProgramCode": "chase",
            "toProgram": "United MileagePlus",
            "toProgramCode": "UA",
            "reason": "United offers excellent availability on Star Alliance",
            "potentialSavings": 2700,
            "displaySavings": "$2,700.00"
        }
    ]
}
```

### POST /api/itinerary/optimize-out-of-pocket

**Request:**
```json
{
    "origin": "JFK",
    "destination": "CDG",
    "outbound_date": "2025-03-15",
    "return_date": "2025-03-25",
    "programs": ["UA", "DL", "AA", "AF"],
    "cabins": ["Economy"],
    "pax": 1
}
```

**Response:**
```json
{
    "origin": "JFK",
    "destination": "CDG",
    "outbound_date": "2025-03-15",
    "return_date": "2025-03-25",
    "best_by_cash": {
        "price": 850,
        "points": null,
        "surcharge": null,
        "out_of_pocket": 850,
        "flights": [
            {
                "departure_airport": {"id": "JFK", "name": "John F. Kennedy International Airport"},
                "arrival_airport": {"id": "CDG", "name": "Charles de Gaulle Airport"},
                "duration": 460,
                "airline": "Air France",
                "flight_number": "AF007"
            }
        ],
        "total_duration": 460
    },
    "best_by_surcharge": {
        "price": 850,
        "points": 60000,
        "surcharge": 280,
        "out_of_pocket": 280,
        "flights": [...],
        "total_duration": 460
    },
    "best_overall": {
        "price": 850,
        "points": 60000,
        "surcharge": 280,
        "out_of_pocket": 280,
        "flights": [...],
        "total_duration": 460
    },
    "options": [
        {"price": 850, "points": 60000, "surcharge": 280, "out_of_pocket": 280, ...},
        {"price": 920, "points": 55000, "surcharge": 150, "out_of_pocket": 150, ...},
        {"price": 750, "points": null, "surcharge": null, "out_of_pocket": 750, ...}
    ]
}
```

### GET /api/destinations/autocomplete

**Request:**
```
GET /api/destinations/autocomplete?q=paris&limit=5
```

**Response:**
```json
{
    "suggestions": [
        {
            "name": "Paris",
            "type": "city",
            "description": "France",
            "id": "PAR",
            "airports": [
                {"id": "CDG", "name": "Charles de Gaulle Airport", "city": "Paris", "distance": "23 km"},
                {"id": "ORY", "name": "Orly Airport", "city": "Paris", "distance": "14 km"}
            ]
        },
        {
            "name": "Paris",
            "type": "city",
            "description": "Texas, United States",
            "id": "PRX",
            "airports": [
                {"id": "PRX", "name": "Cox Field", "city": "Paris", "distance": "5 km"}
            ]
        }
    ]
}
```

### POST /hotels/optimize-out-of-pocket

**Request:**
```json
{
    "destination": "Paris",
    "check_in": "2025-03-15",
    "check_out": "2025-03-20",
    "programs": ["HH", "MAR", "HYATT"],
    "guests": 2
}
```

**Response:**
```json
{
    "destination": "Paris",
    "check_in": "2025-03-15",
    "check_out": "2025-03-20",
    "best_by_cash": {
        "name": "ibis Paris Opera la Fayette",
        "cash": 520.00,
        "points": null,
        "surcharge": null,
        "out_of_pocket": 520.00,
        "brand": "",
        "source": "google_hotels"
    },
    "best_by_points": {
        "name": "Hyatt Regency Paris Etoile",
        "cash": 1200.00,
        "points": 90000,
        "surcharge": 45.00,
        "out_of_pocket": 45.00,
        "brand": "HYATT",
        "source": "awardtool"
    },
    "best_overall": {
        "name": "Hyatt Regency Paris Etoile",
        "cash": 1200.00,
        "points": 90000,
        "surcharge": 45.00,
        "out_of_pocket": 45.00,
        "brand": "HYATT",
        "source": "awardtool"
    },
    "options": [...]
}
```

---

## Fallback Strategies

The backend includes multiple fallback mechanisms to ensure users always get results:

### 1. Flight Search Fallbacks

```
Award-First → SERP-First → SERP-Only → Nearby Hub Search → AI Route Suggestions
```

### 2. Itinerary Generation Fallbacks

```
ILP Optimization → Relaxed Budget Retry → Best-Effort Path → Simple Itineraries → Minimal Fallback
```

### 3. Small Airport Handling

For airports like ITH (Ithaca), the system:
1. Detects no direct flights
2. Finds nearby hubs (SYR, BUF, JFK)
3. Adds ground transport edges (bus/car)
4. Optimizes hub + connecting flight

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

---

## Summary

The Tripy backend is a sophisticated travel optimization system that:

1. **Aggregates** real-time flight data from SerpAPI (cash) and AwardTool (points)
2. **Optimizes** itineraries using Integer Linear Programming to maximize point value
3. **Handles** edge cases with multiple fallback strategies
4. **Caches** API responses to reduce costs and latency
5. **Provides** detailed transfer instructions and booking guidance

The core value proposition is helping users get **maximum value from their credit card points** by finding the optimal combination of cash and points payments for their travel.
