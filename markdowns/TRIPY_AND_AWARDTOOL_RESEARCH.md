# Tripy Research Documentation

## What is Tripy?

**Tripy** is an AI-powered travel planning platform that helps users maximize their credit card points and airline miles to plan affordable trips. It solves the complexity of using loyalty points by automating optimization and providing clear recommendations.

### Core Value Proposition

Tripy addresses these common challenges for points-savvy travelers:

| Challenge | Tripy Solution |
|-----------|----------------|
| Confusing point values | Automatically calculates cents-per-point (CPP) to show true redemption value |
| Too many transfer options | AI selects the best bank → airline transfer path |
| Complex multi-city planning | Determines optimal city ordering automatically |
| Balancing cash and points | ILP optimizer finds the ideal mix to minimize out-of-pocket costs |
| Group coordination | Collaborative tools for voting, cost-splitting, and shared itineraries |

---

## Main Features & Functionality

### 1. Flight Search & Optimization
- Real-time award availability via **AwardTool API** across multiple airline programs (United, American, Delta, British Airways, etc.)
- Cash flight pricing via **SerpAPI/Google Flights** integration
- Multi-strategy search: Award-first, SERP-first, and SERP-only fallbacks
- Panorama calendar integration for year-round award availability patterns
- Support for Economy, Premium Economy, Business, and First Class
- Ground transport options (bus/car) for regional routes when feasible

### 2. Hotel Search & Optimization
- AwardTool Hotel API for points redemptions (Hilton, IHG, Marriott, Hyatt)
- SerpAPI Google Hotels for cash rates
- Out-of-pocket optimization comparing cash vs. points + surcharges
- Star rating filters (3-star, 4-star, 5-star)

### 3. Points Transfer Strategy
Tripy maps bank programs to airline/hotel partners:

| Bank Program | Transfer Partners |
|--------------|-------------------|
| **Chase Ultimate Rewards** | United, Hyatt, Southwest, British Airways, Air France, Singapore |
| **Amex Membership Rewards** | Delta, Hilton (1:2 ratio), JetBlue, British Airways, ANA |
| **Citi ThankYou** | American Airlines, Singapore, Turkish, Qatar |
| **Capital One** | British Airways, Air France, Emirates, Avianca |
| **Bilt** | American Airlines, United, Hyatt, IHG |

Features include:
- Transfer timing awareness (instant vs. 1-2 business days)
- Step-by-step transfer instructions with portal links
- Partner award arbitrage detection

### 4. Integer Linear Programming (ILP) Optimization

Multi-objective optimization balancing three priorities:
- **W1 (10^6)**: Maximize points value (cash saved by using points)
- **W2 (10^3)**: Minimize cash cost
- **W3 (1.0)**: Minimize travel time

Two optimization modes:
- **OOP Mode** (default): Minimize out-of-pocket costs, uses points even at lower CPP
- **CPP Mode**: Maximize cents-per-point value, only uses points if CPP ≥ threshold (typically 1.0¢)

### 5. Solo Trip Workflow
1. **Setup Page**: Enter destinations, dates, budget, points balances, travel preferences
2. **AI Chatbot Assistant**: Natural language input (e.g., "SEA to NRT, Tokyo + Kyoto, March 10–18, max $3000")
3. **Results Page**: Multiple optimized itinerary options with cost breakdowns
4. **Comparison Page**: Side-by-side itinerary comparison
5. **Booking Page**: Detailed transfer and booking instructions

### 6. Group Trip Workflow
1. **Trip Creation**: Organizer sets destinations, dates, budget, party size
2. **Invite System**: Shareable invite codes/links for member onboarding
3. **Member Configuration**: Each member specifies departure airports, dates, points, budget
4. **Points Pooling**: Aggregates points across all members
5. **Cost Allocation**: Fair cost splitting with transparent breakdowns
6. **Booking Coordination**: Synchronized transfer instructions for all members

---

## AwardTool Integration Deep Dive

### Overview

AwardTool is the primary API for award flight and hotel availability. It works alongside SerpAPI (Google Flights/Hotels) to provide both cash and points options for comprehensive trip planning.

### API Configuration

**Environment Variables:**
```
AWARD_TOOL_API_KEY=your_awardtool_api_key
AWARDTOOL_API_KEY=your_awardtool_api_key  # Alternative naming
```

**Configuration Files:**
- `backend/env.example`
- `backend/env_template.txt`
- `backend/apprunner.yaml`

### AwardTool API Endpoints Used

| Endpoint | URL | Purpose |
|----------|-----|---------|
| Flight Search | `https://www.awardtool-api.com/search_real_time` | Real-time award flight availability with points and surcharges |
| Hotel Search | `https://www.awardtool-api.com/search_hotel` | Award and cash hotel rates |
| Panorama Calendar | `https://www.awardtool-api.com/panorama/panorama_calendar_data` | Calendar view of award availability for route optimization |

---

## Core AwardTool Integration Files

### A. Flight Integration (`backend/src/handlers/flights.py`)

**Key Functions:**

| Function | Line | Purpose |
|----------|------|---------|
| `_awardtool_request()` | 275 | Makes single API request to AwardTool |
| `_awardtool_realtime()` | 229 | Handles caching, retries, and error handling |
| `_merge_award_edges()` | 301 | Processes AwardTool response into flight edges |
| `get_flights_award_first_with_points_async()` | 355 | Award-first search strategy |
| `get_flights_serp_first_with_points_async()` | 505 | SERP-first, then AwardTool matching |

**Features:**
- Caching (6-hour TTL for successful responses)
- Retry logic: falls back to common programs if full list fails
- Combines AwardTool (points) with SerpAPI (cash) for complete options
- Extracts operating carrier for codeshare flights

### B. Hotel Integration (`backend/src/handlers/hotels.py`)

**Key Functions:**

| Function | Line | Purpose |
|----------|------|---------|
| `_awardtool_hotel_search()` | 64 | Makes hotel API request |
| `_parse_hotel_results()` | 124 | Normalizes AwardTool response |
| `search_hotels_async()` | 162 | Public async API |
| `search_hotels()` | 194 | Synchronous wrapper |

**Supported Hotel Programs:**
- Hilton Honors (HH)
- IHG One Rewards
- Marriott Bonvoy (MAR)
- World of Hyatt (HYATT)

**Response Format:**
```python
{
    "hotel_id": "...",
    "name": "...",
    "brand": "...",
    "program_code": "HH",
    "cash_cost": 250.00,
    "points_cost": 40000,
    "surcharge": 0,
    "star_rating": 4
}
```

### C. Calendar Integration (`backend/src/handlers/award_calendar.py`)

**Key Functions:**

| Function | Line | Purpose |
|----------|------|---------|
| `fetch_awardtool_calendar()` | 35 | Fetches raw calendar data |
| `normalize_awardtool_calendar_row()` | 56 | Normalizes calendar rows |
| `get_calendar_matrix()` | 94 | Returns full calendar matrix |
| `best_dates_by_cabin()` | 99 | Finds best dates for a cabin class |

**Purpose:** Used for date flexibility optimization and transfer strategy suggestions.

---

## Service Layer Integration

### `backend/src/services/serp_api_functions.py`

| Function | Line | Purpose |
|----------|------|---------|
| `fetch_awardtool()` | 169 | Synchronous AwardTool flight search |
| `optimize_itinerary_out_of_pocket()` | 218 | Combines SerpAPI + AwardTool for round-trip optimization |
| `optimize_hotels_out_of_pocket()` | 413 | Combines AwardTool hotels + SerpAPI Google Hotels |

### `backend/src/services/itinerary_service.py`

**AwardTool Usage:**
- Calls `get_flights_award_first_with_points_async()` and `get_flights_serp_first_with_points_async()` (lines 1513-1586)
- Used in `_fetch_edges_for_route()` for itinerary generation
- Fallback chain: Award-first → SERP-first → SERP-only
- `_get_transfer_tips_from_panorama()` (line 1356) - Uses Panorama calendar for transfer strategy suggestions

---

## API Endpoints Using AwardTool

### Flight-Related Endpoints

| Endpoint | Handler | AwardTool Usage |
|----------|---------|-----------------|
| `/itinerary/generate` | `app.py:820` | Via `itinerary_service.generate_simple_itineraries()` |
| `/api/itinerary/optimize-out-of-pocket` | `app.py:1152` | Via `serp_api_functions.optimize_itinerary_out_of_pocket()` |

### Hotel-Related Endpoints

| Endpoint | Handler | AwardTool Usage |
|----------|---------|-----------------|
| `/hotels/search` | `app.py:940` | Via `handlers.hotels.search_hotels_async()` |
| `/hotels/optimize-out-of-pocket` | `app.py:968` | Via `serp_api_functions.optimize_hotels_out_of_pocket()` |

---

## Award Programs Configuration

### `backend/src/utils/award_programs.py`

**Key Function:** `get_award_programs_for_api()` (line 216)

**Default Programs Queried:**
```python
[
    "UA",  # United Airlines
    "AA",  # American Airlines
    "DL",  # Delta Air Lines
    "AS",  # Alaska Airlines
    "B6",  # JetBlue
    "AC",  # Air Canada
    "BA",  # British Airways
    "AF",  # Air France
    "KL",  # KLM
    "LH",  # Lufthansa
    "LX",  # Swiss
    "SQ",  # Singapore Airlines
    "CX",  # Cathay Pacific
    "NH",  # ANA
    "JL",  # Japan Airlines
    "EK",  # Emirates
    "QR",  # Qatar Airways
    "EY",  # Etihad
    "TK",  # Turkish Airlines
    "AV",  # Avianca
    "IB",  # Iberia
    "QF",  # Qantas
    "VS"   # Virgin Atlantic
]
```

**Transfer Graph:** Maps bank programs to airline/hotel partners with transfer ratios and timing.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    API Request Layer                        │
│  (/itinerary/generate, /hotels/search, etc.)               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                  Service Layer                              │
│  (itinerary_service, serp_api_functions)                   │
└────────────────────┬────────────────────────────────────────┘
                     │
         ┌───────────┴───────────┐
         │                       │
         ▼                       ▼
┌──────────────────┐   ┌──────────────────┐
│   AwardTool      │   │    SerpAPI        │
│   (Points)       │   │    (Cash)         │
│                  │   │                   │
│ - Flights        │   │ - Google Flights  │
│ - Hotels         │   │ - Google Hotels   │
│ - Panorama       │   │                   │
└────────┬─────────┘   └────────┬─────────┘
         │                       │
         └───────────┬───────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Data Processing & Merging                      │
│  (_merge_award_edges, serp_route_to_leg_map)                │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              Optimization & ILP Solver                      │
│  (ilp_adapter, min_oop_optimizer)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Response to Client                      │
└─────────────────────────────────────────────────────────────┘
```

---

## Caching Strategy

| Data Type | TTL | Constant |
|-----------|-----|----------|
| AwardTool Flights | 6 hours | `TTL_AWARD = 6 * 3600` |
| AwardTool Hotels | 6 hours | `TTL_HOTEL = 6 * 3600` |
| Panorama Calendar | 24 hours | `TTL_PAN = 24 * 3600` |
| SerpAPI Flights | 90 minutes | `TTL_SERP = 90 * 60` |

---

## Error Handling & Fallbacks

**Error Handling Patterns:**
1. Retry with reduced program list if full query fails (`flights.py:255-262`)
2. Fallback to SERP-only if AwardTool fails completely
3. Cache only successful responses (errors not cached)
4. Graceful degradation: continues with available data

**Fallback Chain:**
```
Award-first search → SERP-first search → SERP-only search
```

---

## Test Files

| File | Purpose |
|------|---------|
| `backend/test_transfer_strategy_mock.py` | Mock AwardTool for unit testing |
| `backend/test_transfer_strategy_live.py` | Live AwardTool integration tests |
| `backend/test_jfk_fll.py` | Flight search tests with AwardTool |

---

## Technical Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 15, React 19, TypeScript, Tailwind CSS |
| Backend | FastAPI (Python), AWS Lambda, DynamoDB |
| Authentication | AWS Cognito |
| Optimization | PuLP library with CBC solver for ILP |
| APIs | AwardTool (awards), SerpAPI (cash), Panorama (calendar) |
| Infrastructure | AWS App Runner, AWS Amplify |

---

## Summary Statistics

| Metric | Count |
|--------|-------|
| Files referencing AwardTool | ~20+ |
| Main integration files | 3 (flights.py, hotels.py, award_calendar.py) |
| API endpoints using AwardTool | 4+ |
| Service functions | 10+ |
| Supported airline programs | 23 |
| Supported hotel programs | 4 |

---

## Example User Journey

### Solo Trip Example

1. **User Input:** "JFK to Paris, March 15-22, 150,000 Chase points"
2. **System Searches:** AwardTool + SerpAPI for flights
3. **Optimization:** Finds United award (60k miles + $50) vs. $800 cash
4. **Result:** Recommends using points (CPP = 1.25¢), saves $750
5. **Instructions:** Transfer 60k Chase → United, book via United.com

### Group Trip Example

1. **Organizer Creates Trip:** "4 friends, NYC to Tokyo + Paris, flexible dates"
2. **Members Join:** Each adds departure city, dates, points balances
3. **System Pools:** 500k total points across Chase, Amex, United, Delta
4. **Optimization:** Generates 3-5 itinerary options optimizing across all members
5. **Results:** Shows per-member costs, recommends optimal point allocation
6. **Booking:** Coordinated transfer instructions for all members

---

## Conclusion

Tripy transforms complex point redemptions into streamlined, optimized decisions that maximize value and minimize out-of-pocket costs. AwardTool serves as the critical data source for award flight and hotel availability, enabling Tripy to compare points vs. cash options and recommend the best redemption strategies for both solo and group travelers.
