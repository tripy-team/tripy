# Tripy Implementation Plan

## Executive Summary

This document outlines a detailed implementation plan for Tripy, an AI-powered travel planning platform that optimizes credit card points and airline miles for maximum value. The frontend is largely complete; this plan focuses on backend implementation, API integrations, and system refinements needed for production deployment.

---

## Table of Contents

1. [Current State Assessment](#current-state-assessment)
2. [Architecture Overview](#architecture-overview)
3. [Phase 1: Core Backend Services](#phase-1-core-backend-services)
4. [Phase 2: External API Integration](#phase-2-external-api-integration)
5. [Phase 3: ILP Optimization Engine](#phase-3-ilp-optimization-engine)
6. [Phase 4: Group Trip Features](#phase-4-group-trip-features)
7. [Phase 5: Production Hardening](#phase-5-production-hardening)
8. [Phase 6: Advanced Features](#phase-6-advanced-features)
9. [API Endpoint Specifications](#api-endpoint-specifications)
10. [Database Schema Details](#database-schema-details)
11. [Deployment Strategy](#deployment-strategy)
12. [Testing Strategy](#testing-strategy)

---

## Current State Assessment

### Frontend (Largely Complete)

| Component | Status | Notes |
|-----------|--------|-------|
| Authentication (Login/Register/Forgot Password) | ✅ Complete | AWS Cognito integration |
| Dashboard | ✅ Complete | Trip list, savings display |
| Solo Trip Setup | ✅ Complete | Destinations, dates, budget |
| Group Trip Setup | ✅ Complete | Invite system, voting |
| Points Allocation | ✅ Complete | Multi-program support |
| Results/Comparison | ✅ Complete | Itinerary cards |
| Booking Page | ✅ Complete | Transfer instructions |
| Profile/Settings | ✅ Complete | User preferences |
| Autocomplete Components | ✅ Complete | Airport/City search |

### Backend (Partially Implemented)

| Component | Status | Notes |
|-----------|--------|-------|
| FastAPI Application | ✅ Complete | Basic structure |
| Authentication Service | ✅ Complete | Cognito integration |
| User Service | ✅ Complete | CRUD operations |
| Trip Service | ✅ Complete | Trip management |
| Destination Service | ✅ Complete | Destination management |
| Points Service | ✅ Complete | Points CRUD |
| Itinerary Service | ✅ Complete | Generation + optimization |
| ILP Optimizer | ✅ Complete | Points maximization |
| AwardTool Integration | ✅ Complete | Award flights |
| SerpAPI Integration | ✅ Complete | Cash prices |
| City/Airport Search | ✅ Complete | Amadeus + CSV fallback |
| Image Service | ✅ Complete | S3/CloudFront |
| Ground Transport | ✅ Complete | Bus/car options |
| Hotel Search | ✅ Complete | AwardTool hotels |

### Infrastructure

| Component | Status | Notes |
|-----------|--------|-------|
| AWS CDK | ✅ Complete | Infrastructure as code |
| DynamoDB Tables | ✅ Complete | 7 tables defined |
| AWS Cognito | ✅ Complete | User pools |
| S3/CloudFront | ✅ Complete | Image hosting |
| App Runner | ✅ Complete | Backend deployment |
| Amplify | ✅ Complete | Frontend deployment |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Next.js 15)                          │
│                                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────────┐   │
│  │  Dashboard  │ │  Trip Setup │ │  Results    │ │  Booking/Transfer   │   │
│  │             │ │ Solo/Group  │ │  Compare    │ │    Instructions     │   │
│  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────────┘   │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │               API Client (lib/api.ts) - Auth + Requests              │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          BACKEND (FastAPI + Lambda)                         │
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         API Layer (app.py)                           │   │
│  │   /auth/*  /trips/*  /destinations/*  /points/*  /itinerary/*       │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐ │
│  │                        SERVICE LAYER                                  │ │
│  │                                                                       │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│  │  │   Auth       │ │   Trip       │ │  Itinerary   │ │   Points     │ │ │
│  │  │   Service    │ │   Service    │ │   Service    │ │   Service    │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│  │                                                                       │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│  │  │ Destination  │ │   City       │ │   Image      │ │   User       │ │ │
│  │  │   Service    │ │   Service    │ │   Service    │ │   Service    │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐ │
│  │                     OPTIMIZATION ENGINE                               │ │
│  │                                                                       │ │
│  │  ┌──────────────────────────────────────────────────────────────┐    │ │
│  │  │              ILP Optimizer (PuLP/CBC)                         │    │ │
│  │  │  • Points Value Maximization                                  │    │ │
│  │  │  • Multi-Traveler Support                                     │    │ │
│  │  │  • Dynamic City Ordering                                      │    │ │
│  │  │  • Transfer Partner Optimization                              │    │ │
│  │  │  • Card Benefits Integration                                  │    │ │
│  │  └──────────────────────────────────────────────────────────────┘    │ │
│  │                                                                       │ │
│  │  ┌──────────────────────────────────────────────────────────────┐    │ │
│  │  │              ILP Adapter                                      │    │ │
│  │  │  • Edge Graph Construction                                    │    │ │
│  │  │  • Transfer Graph Mapping                                     │    │ │
│  │  │  • Balance/Budget Allocation                                  │    │ │
│  │  └──────────────────────────────────────────────────────────────┘    │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐ │
│  │                     EXTERNAL API HANDLERS                             │ │
│  │                                                                       │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│  │  │  AwardTool   │ │   SerpAPI    │ │   Amadeus    │ │   OpenAI     │ │ │
│  │  │  (Awards)    │ │(Cash Prices) │ │  (Search)    │ │   (NLP)      │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
│                                      │                                      │
│  ┌───────────────────────────────────┼───────────────────────────────────┐ │
│  │                        REPOSITORY LAYER                               │ │
│  │                                                                       │ │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │ │
│  │  │  Trip Repo   │ │ Itinerary    │ │  Points      │ │   User       │ │ │
│  │  │              │ │   Repo       │ │    Repo      │ │    Repo      │ │ │
│  │  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘ │ │
│  └───────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
          ┌─────────────────┐ ┌─────────────┐ ┌─────────────────┐
          │    DynamoDB     │ │  AWS Cognito │ │  S3/CloudFront  │
          │    (7 tables)   │ │  (Auth)      │ │  (Images)       │
          └─────────────────┘ └─────────────┘ └─────────────────┘
```

---

## Phase 1: Core Backend Services

### 1.1 Authentication & User Management

**Status:** ✅ Complete

**Implementation Details:**

```python
# auth_service.py - Cognito integration
class AuthService:
    def authenticate_user(email, password) -> AuthResult
    def sign_up_user(email, password, attributes) -> SignUpResult
    def confirm_sign_up(email, code) -> None
    def refresh_tokens(refresh_token) -> TokenResult
    def forgot_password(email) -> CodeDeliveryResult
    def confirm_forgot_password(email, code, new_password) -> None
```

**Key Files:**
- `backend/src/services/auth_service.py`
- `backend/src/utils/jwt_auth.py`
- `backend/src/utils/auth.py`

### 1.2 Trip Management

**Status:** ✅ Complete

**Implementation Details:**

```python
# trip_service.py
class TripService:
    def create_trip(user_id, title, start_date, end_date, **kwargs) -> Trip
    def get_trip(trip_id) -> Trip
    def list_trips_for_user(user_id) -> List[Trip]
    def delete_trip(trip_id, user_id) -> bool
    def regenerate_invite_code(trip_id, user_id) -> InviteResult
    def get_trip_by_invite(invite_code) -> Trip
```

**Data Model:**
```python
class Trip:
    tripId: str           # Primary key
    createdBy: str        # User ID
    title: str
    startDate: str        # ISO format YYYY-MM-DD
    endDate: str
    inviteCode: str       # 8-char unique code
    status: str           # "active", "completed"
    includeHotels: bool   # Include hotel costs
    maxBudget: int        # Cash budget limit
    durationDays: int     # For flexible dates
```

### 1.3 Destination Management

**Status:** ✅ Complete

**Implementation Details:**

```python
# destination_service.py
class DestinationService:
    def add_destination(trip_id, user_id, name, must_include, excluded, 
                       is_start, is_end) -> Destination
    def list_destinations(trip_id) -> List[Destination]
    def scores(trip_id) -> Dict[str, float]  # Voting scores
```

**Data Model:**
```python
class Destination:
    tripId: str
    destinationId: str    # UUID
    name: str             # City name or "City (IATA)"
    mustInclude: bool     # Required destination
    excluded: bool        # Excluded from optimization
    isStart: bool         # Trip origin
    isEnd: bool           # Trip return point
    createdBy: str
```

### 1.4 Points Management

**Status:** ✅ Complete

**Implementation Details:**

```python
# points_service.py
class PointsService:
    def upsert_points(trip_id, user_id, program, balance) -> Points
    def trip_points_summary(trip_id) -> PointsSummary
    def get_valuations() -> Dict[str, float]  # TPG valuations
```

**Data Model:**
```python
class Points:
    tripId: str
    userId: str
    program: str          # "Chase Ultimate Rewards", "UA", etc.
    balance: int
```

**Program Normalization:**
- Bank programs: `"Chase Ultimate Rewards"` → `"chase"`
- Airline programs: `"United MileagePlus"` → `"UA"`
- Hotel programs: `"Marriott Bonvoy"` → `"MAR"`

---

## Phase 2: External API Integration

### 2.1 AwardTool API Integration

**Status:** ✅ Complete

**Purpose:** Fetch award flight availability and pricing

**Implementation:**

```python
# flights.py
async def get_flights_award_first_with_points_async(
    origin: str,
    destination: str,
    combined_points: Dict[str, int],
    filters: Dict[str, Any]
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    """
    Fetch award flights from AwardTool API.
    Returns edges_dict: {(origin, dest, flight_num): edge_data}
    
    Edge data includes:
    - cash_cost: Float - equivalent cash price
    - points_cost: Float - miles required
    - points_surcharge: Float - taxes/fees
    - points_program: str - airline code (UA, AA, DL, etc.)
    - time_cost: Float - duration in minutes
    - operating_airline: str - actual carrier (for codeshares)
    """
```

**API Endpoints Used:**
- `POST /flights` - Search award flights
- `POST /panorama/panorama_calendar_data` - Calendar availability

**Response Processing:**
```python
def _process_awardtool_response(raw_data):
    edges = {}
    for flight in raw_data.get("flights", []):
        edge_key = (flight["origin"], flight["destination"], flight["flight_number"])
        edges[edge_key] = {
            "cash_cost": flight.get("cash_price", 0),
            "points_cost": flight.get("miles", 0),
            "points_surcharge": flight.get("surcharge", 0),
            "points_program": flight.get("program", "").upper(),
            "time_cost": flight.get("duration", 0),
            "operating_airline": flight.get("operating_carrier", ""),
        }
    return edges
```

### 2.2 SerpAPI Integration (Google Flights)

**Status:** ✅ Complete

**Purpose:** Fetch cash prices for comparison

**Implementation:**

```python
# serp_api_functions.py
def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str = None,
    **kwargs
) -> List[Dict]:
    """
    Fetch cash flight prices from Google Flights via SerpAPI.
    """
```

**Combined Optimization:**
```python
# serp_api_functions.py
def optimize_itinerary_out_of_pocket(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str,
    programs: List[str],
    cabins: List[str],
    pax: int,
    commercial_only: bool = False
) -> Dict[str, Any]:
    """
    Compare AwardTool awards vs SerpAPI cash.
    Returns: {
        best_by_cash: {...},
        best_by_surcharge: {...},
        best_overall: {...},
        options: [...]
    }
    """
```

### 2.3 Amadeus API Integration

**Status:** ✅ Complete

**Purpose:** City/airport autocomplete search

**Implementation:**

```python
# city_service.py
def search_cities(query: str, max_results: int = 10) -> List[Dict]:
    """
    Search cities and airports using Amadeus API.
    Falls back to CSV data if API unavailable.
    """
```

**CSV Fallback:**
- `backend/files/airports.csv` - Airport data
- `backend/files/countries.csv` - Country data
- `backend/files/regions.csv` - Region data

### 2.4 OpenAI Integration

**Status:** ✅ Complete

**Purpose:** NLP for trip extraction, smart suggestions

**Implementation:**

```python
# openAI.py
def extract_trip_info_with_openai(text: str) -> ExtractedTripInfo:
    """Extract structured trip info from natural language."""

def suggest_routes_for_remote_or_small_cities(
    origin: str,
    destination: str,
    city_names: List[str],
    start_date: str,
    end_date: str,
    failed_routes: List[str]
) -> List[Dict]:
    """Suggest alternative routes when flight data unavailable."""

def get_itinerary_smart_tips(
    origin: str,
    destination: str,
    city_names: List[str],
    start_date: str,
    end_date: str,
    points_programs: List[str]
) -> Dict:
    """Generate transfer tips, sample itineraries, holiday advice."""
```

---

## Phase 3: ILP Optimization Engine

### 3.1 Core Optimizer

**Status:** ✅ Complete

**Location:** `backend/src/handlers/points_maximizer.py`

**Objective Function:**

```
MAXIMIZE: W₁×(Points Value) - W₂×(Cash Paid) - W₃×(Travel Time) + W₄×(Card Benefits)

Where:
- W₁ = 10⁶  (prioritize high points value redemptions)
- W₂ = 10³  (minimize cash expenditure)
- W₃ = 1.0  (secondary: minimize travel time)
- W₄ = 10⁴  (bonus for card benefits like free bags)
```

**Points Value Calculation:**

```python
def get_points_value(airline, edge):
    """Calculate cents per point (CPP) for redemption."""
    miles = get_miles(airline, edge)
    cash = cash_cost.get(edge, 0.0)
    surcharge = get_tax(airline, edge)
    cash_saved = cash - surcharge
    
    if cash_saved <= 0 or miles <= 0:
        return 0.0
    
    # Return cents per point
    return (cash_saved * 100.0) / miles
```

**Decision Variables:**

```python
# x[p][e] - Binary: Does passenger p take edge e?
x = {p: {e: LpVariable(f"x_{p}_{e}", cat="Binary") for e in edges} for p in travelers}

# z[(q,p)][e] - Binary: Does payer q pay cash for passenger p on edge e?
z = {(q, p): {e: LpVariable(f"z_{q}_{p}_{e}", cat="Binary") for e in edges}
     for q in travelers for p in travelers}

# y[(q,p)][(s,a)][e] - Binary: Does payer q use bank s → airline a for passenger p on edge e?
y = {(q, p): {(s, a): {e: LpVariable(...) for e in edges}
              for (s, a) in allowed_transfers}
     for q in travelers for p in travelers}

# y_native[(q,p)][a][e] - Binary: Does payer q use native airline a miles for passenger p?
y_native = {(q, p): {a: {e: LpVariable(...) for e in edges} for a in airlines}
            for q in travelers for p in travelers}

# t_blocks[q][(s,a)] - Integer: Transfer blocks from bank s to airline a for payer q
t_blocks = {q: {(s, a): LpVariable(..., cat="Integer") for (s, a) in allowed_transfers}
            for q in travelers}
```

**Constraints:**

1. **Path Constraints:** Valid path from start to end city
2. **Must-Visit:** Each selected destination visited exactly once
3. **Payment Exclusivity:** Each segment has exactly one payment method
4. **Points Limits:** Cannot exceed available balances
5. **Cash Budget:** Total cash ≤ per-traveler budget
6. **Transfer Rules:** Only valid transfer partners
7. **Seat Availability:** Respect award seat limits

### 3.2 ILP Adapter

**Status:** ✅ Complete

**Location:** `backend/src/handlers/ilp_adapter.py`

**Purpose:** Transform flight edges into ILP inputs

```python
def build_ilp_inputs_from_edges(
    edges_dict: Dict[Tuple[str,str,str], Dict],
    travelers: List[str],
    start_city_by_trav: Dict[str, str],
    end_city_by_trav: Dict[str, str],
    user_points_by_trav: Dict[str, Dict[str, float]],
    meetup_cities: List[str] = None,
    transfer_graph: Dict = None,
    bank_block_size: int = 1000,
    default_cash_budget: float = 1e9,
    **kwargs
) -> Dict[str, Any]:
    """
    Transform raw edges and user data into ILP-ready inputs.
    
    Returns:
    {
        "travelers": [...],
        "cities": [...],
        "edges": [...],
        "time_cost": {...},
        "cash_cost": {...},
        "airlines": [...],
        "award_points": {...},
        "cash_surcharge": {...},
        "allowed_award_edge": {...},
        "sources_by_trav": {...},
        "source_balances": {...},
        "allowed_sa": {...},
        "ratio": {...},
        "bonus": {...},
        "miles_balance": {...},
        "link_ok": {...},
        "budget_cash": {...},
        "can_pay_for": {...},
        ...
    }
    """
```

### 3.3 Transfer Graph

**Status:** ✅ Complete

**Location:** `backend/src/utils/award_programs.py`

```python
DEFAULT_TRANSFER_GRAPH = {
    "chase": {
        "UA": 1.0,  # United
        "BA": 1.0,  # British Airways
        "AF": 1.0,  # Air France
        "SQ": 1.0,  # Singapore
        "IB": 1.0,  # Iberia
        "VS": 1.0,  # Virgin Atlantic
        "AC": 1.0,  # Aeroplan
        ...
    },
    "amex": {
        "DL": 1.0,  # Delta
        "BA": 1.0,  # British Airways
        "AF": 1.0,  # Air France
        "NH": 1.0,  # ANA
        "SQ": 1.0,  # Singapore
        ...
    },
    "citi": {
        "TK": 1.0,  # Turkish
        "AF": 1.0,  # Air France
        "SQ": 1.0,  # Singapore
        "B6": 1.0,  # JetBlue
        ...
    },
    "capitalone": {
        "AF": 0.75,  # 2:1.5 ratio
        "BA": 0.75,
        "TK": 0.75,
        ...
    },
    "bilt": {
        "AA": 1.0,  # American
        "UA": 1.0,  # United
        "AF": 1.0,  # Air France
        "TK": 1.0,  # Turkish
        ...
    }
}
```

### 3.4 Card Benefits Integration

**Status:** ✅ Complete

**Location:** `backend/src/utils/card_benefits.py`

```python
def build_benefit_airlines_for_travelers(
    traveler_profiles: Dict[str, Dict]
) -> Dict[str, Set[str]]:
    """
    Build mapping of {traveler_id: set(airline_codes)} 
    where traveler has free checked bags.
    
    Example: Delta Gold card → free bags on DL flights
    """
```

**Card Product to Benefit Mapping:**
```python
CARD_BENEFITS = {
    "Delta SkyMiles Gold": {"free_bags": ["DL"]},
    "Delta SkyMiles Platinum": {"free_bags": ["DL"]},
    "United Quest": {"free_bags": ["UA"]},
    "American Airlines Citi Executive": {"free_bags": ["AA"]},
    ...
}
```

---

## Phase 4: Group Trip Features

### 4.1 Trip Member Management

**Status:** ✅ Complete

**Implementation:**

```python
# trip_member_service.py
class TripMemberService:
    def add_member(trip_id, user_id, role="member") -> TripMember
    def list_members(trip_id) -> List[TripMember]
    def join_trip(user_id, invite_code) -> JoinResult
    def remove_member(trip_id, user_id) -> bool
```

**Data Model:**
```python
class TripMember:
    tripId: str
    userId: str
    role: str      # "admin" or "member"
    status: str    # "active" or "invited"
    joinedAt: str  # ISO timestamp
```

### 4.2 Destination Voting

**Status:** ✅ Complete

**Implementation:**

```python
# destination_vote_repo.py
class DestinationVoteRepo:
    def cast_vote(trip_id, destination_id, user_id, rank) -> Vote
    def get_votes(trip_id) -> List[Vote]
    def tally_scores(trip_id) -> Dict[str, float]
```

**Scoring Algorithm:**
```python
def tally_scores(votes: List[Vote]) -> Dict[str, float]:
    """
    Borda count scoring: higher rank = more points
    First choice = N points, Second = N-1, etc.
    """
    scores = {}
    for vote in votes:
        dest_id = vote.destination_id
        # Inverse rank scoring
        score = max_rank - vote.rank + 1
        scores[dest_id] = scores.get(dest_id, 0) + score
    return scores
```

### 4.3 Cost Splitting

**Status:** ⚠️ Needs Enhancement

**Current State:** Basic allocation via ILP `can_pay_for` constraint

**Proposed Enhancement:**

```python
# cost_splitting_service.py
class CostSplittingService:
    def calculate_fair_split(
        solution: Dict,
        travelers: List[str],
        points_by_trav: Dict[str, Dict[str, float]]
    ) -> CostSplit:
        """
        Calculate fair cost allocation:
        1. Track who paid what (cash or points)
        2. Value points at redemption CPP achieved
        3. Calculate each person's share of total cost
        4. Determine settlements (who owes whom)
        """
```

**Output Structure:**
```python
class CostSplit:
    contributions: Dict[str, Contribution]  # {user_id: {cash, points_value}}
    flight_values: Dict[str, float]         # {user_id: total_flight_value}
    settlements: List[Settlement]            # [{"from": x, "to": y, "amount": z}]
    total_savings: float
    savings_percentage: float
```

---

## Phase 5: Production Hardening

### 5.1 Caching Layer

**Status:** ⚠️ Needs Implementation

**Proposed Implementation:**

```python
# cache_layer.py
class CacheLayer:
    """Multi-tier caching: in-memory → DynamoDB → external API"""
    
    def __init__(self):
        self.local_cache = {}  # In-memory (for Lambda warm starts)
        self.ttls = {
            "award_flights": 6 * 3600,      # 6 hours
            "cash_flights": 90 * 60,        # 90 minutes
            "city_search": 24 * 3600,       # 24 hours
            "tpg_valuations": 12 * 3600,    # 12 hours
        }
    
    async def get_or_fetch(self, key: str, fetch_fn: Callable, cache_type: str):
        # 1. Check local cache
        if key in self.local_cache:
            if not self._is_expired(key):
                return self.local_cache[key]
        
        # 2. Check DynamoDB cache
        cached = await self._get_from_dynamo(key)
        if cached and not self._is_expired_dynamo(cached):
            self.local_cache[key] = cached["data"]
            return cached["data"]
        
        # 3. Fetch from external API
        data = await fetch_fn()
        await self._store_in_dynamo(key, data, self.ttls[cache_type])
        self.local_cache[key] = data
        return data
```

**DynamoDB Cache Table:**
```
Table: tripy-cache
  PK: cache_key (String)
  SK: "CACHE"
  data: (String - JSON)
  ttl: (Number - Unix timestamp for DynamoDB TTL)
  created_at: (String - ISO timestamp)
```

### 5.2 Rate Limiting

**Status:** ⚠️ Needs Implementation

**Proposed Implementation:**

```python
# rate_limiter.py
class RateLimiter:
    """Token bucket rate limiter for external APIs"""
    
    LIMITS = {
        "awardtool": (100, 60),    # 100 requests per 60 seconds
        "serpapi": (100, 60),
        "amadeus": (10, 1),        # 10 requests per second
        "openai": (60, 60),
    }
    
    async def acquire(self, api_name: str):
        limit, window = self.LIMITS[api_name]
        # Token bucket implementation with DynamoDB for distributed rate limiting
```

### 5.3 Error Handling & Fallbacks

**Status:** ✅ Complete

**Implementation Patterns:**

```python
# Fallback hierarchy for flight search
async def get_flights_with_fallback(origin, dest, date, points, filters):
    # 1. Try AwardTool award-first
    edges = await get_flights_award_first_with_points_async(...)
    
    if not edges:
        # 2. Try SerpAPI-first
        edges = await get_flights_serp_first_with_points_async(...)
    
    if not edges:
        # 3. Try SerpAPI cash-only
        edges = await get_flights_serp_only(...)
    
    if not edges:
        # 4. Try nearby hub airports
        for hub in SMALL_AIRPORT_NEARBY_HUBS.get(origin, []):
            edges = await get_flights_from_hub(hub, dest, ...)
            if edges:
                break
    
    if not edges:
        # 5. Return AI-suggested routes
        return suggest_routes_with_openai(origin, dest, ...)
    
    return edges
```

**Budget Relaxation:**
```python
# When ILP is infeasible, try relaxed budgets
async def optimize_with_budget_relaxation(trip_id):
    solution = run_ilp(...)
    
    if solution["status"] == "Infeasible":
        # Try 2x, 3x, 5x, 10x budget
        for multiplier in [2, 3, 5, 10]:
            relaxed_budget = original_budget * multiplier
            solution = run_ilp(..., default_cash_budget=relaxed_budget)
            if solution["status"] == "Optimal":
                solution["relaxed_message"] = f"Budget increased to ${relaxed_budget:,}"
                break
        
        # Last resort: best-effort path (may exceed all constraints)
        if solution["status"] != "Optimal":
            solution = find_minimum_cost_path(edges)
    
    return solution
```

### 5.4 Monitoring & Logging

**Status:** ⚠️ Needs Enhancement

**Proposed Implementation:**

```python
# analytics.py
class Analytics:
    """Track key metrics for monitoring"""
    
    def track_itinerary_generated(user_id, trip_id, route_count, total_savings):
        # CloudWatch metrics
        cloudwatch.put_metric_data(
            Namespace="Tripy",
            MetricData=[
                {"MetricName": "ItineraryGenerated", "Value": 1},
                {"MetricName": "TotalSavings", "Value": total_savings},
                {"MetricName": "RouteCount", "Value": route_count},
            ]
        )
    
    def track_api_latency(api_name, duration_ms, success):
        cloudwatch.put_metric_data(
            Namespace="Tripy/ExternalAPIs",
            MetricData=[
                {"MetricName": f"{api_name}_Latency", "Value": duration_ms},
                {"MetricName": f"{api_name}_Success", "Value": 1 if success else 0},
            ]
        )
```

---

## Phase 6: Advanced Features

### 6.1 Real-Time Award Tracking (Future)

**Concept:**
- Store award availability snapshots
- Alert users when prices drop below threshold
- Track historical trends for price prediction

**Proposed Architecture:**
```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│  Scheduler  │────▶│  Fetch Jobs │────▶│  DynamoDB   │
│  (EventBridge)    │  (Lambda)   │     │  (Snapshots)│
└─────────────┘     └─────────────┘     └─────────────┘
                                               │
                                               ▼
                    ┌─────────────┐     ┌─────────────┐
                    │    SNS      │────▶│   Users     │
                    │  (Alerts)   │     │  (Email/App)│
                    └─────────────┘     └─────────────┘
```

### 6.2 Multi-Airline Itineraries (Future)

**Concept:** Combine different airlines on a single trip path

**Implementation Considerations:**
- Separate ticketing for each airline
- Connection time validation
- Baggage transfer rules
- Enhanced ILP constraints

### 6.3 Hotel Optimization Integration (Future)

**Current:** Hotel search is separate from flight optimization

**Proposed:** Unified ILP that includes hotels

```python
def plan_unified_itinerary(
    travelers, cities, edges, hotels,
    flight_points, hotel_points, cash_budget
):
    """
    Joint optimization of flights AND hotels.
    
    Additional decision variables:
    - h[p][city][hotel] - Binary: does passenger p stay at hotel in city?
    
    Additional constraints:
    - Must book hotel for each overnight city
    - Hotel points from compatible programs
    """
```

---

## API Endpoint Specifications

### Authentication Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/login` | POST | No | User login |
| `/auth/signup` | POST | No | User registration |
| `/auth/confirm` | POST | No | Confirm email |
| `/auth/refresh` | POST | No | Refresh tokens |
| `/auth/forgot-password` | POST | No | Initiate password reset |
| `/auth/confirm-forgot-password` | POST | No | Complete password reset |

### Trip Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/trips` | POST | Yes | Create trip |
| `/trips` | GET | Yes | List user's trips |
| `/trips/get` | POST | Yes | Get trip by ID |
| `/trips/invite` | POST | Yes | Get invite code |
| `/trips/invite/regenerate` | POST | Yes | Regenerate invite code |
| `/trips/by-invite/{code}` | GET | No | Get trip by invite (public) |
| `/trips/join` | POST | Yes | Join trip via invite |
| `/trips/members` | POST | Yes | List trip members |
| `/trips/delete` | POST | Yes | Delete trip |

### Destination Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/destinations/add` | POST | Yes | Add destination |
| `/destinations/list` | POST | Yes | List destinations |

### Points Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/points/upsert` | POST | Yes | Add/update points |
| `/points/summary` | POST | Yes | Get trip points summary |
| `/points/valuations` | GET | Yes | Get TPG valuations |

### Itinerary Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/itinerary/generate` | POST | Yes | Generate optimized itinerary |
| `/itinerary/get` | POST | Yes | Get saved itinerary |

### Search Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/api/airports/autocomplete` | GET | No | Airport search |
| `/api/destinations/autocomplete` | GET | No | Destination search |
| `/api/locations/autocomplete` | GET | No | Unified location search |
| `/api/locations/{city_id}/airports` | GET | No | Nearby airports |
| `/cities/search` | GET | No | City search (Amadeus) |

### Hotel Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/hotels/search` | POST | Yes | Search hotels |
| `/hotels/optimize-out-of-pocket` | POST | Yes | Optimize hotel costs |

### User Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/users/me` | GET | Yes | Get profile |
| `/users/profile` | PUT | Yes | Update profile |
| `/users/me/savings` | GET | Yes | Get total savings |
| `/users/me/savings/calculate` | POST | Yes | Recalculate savings |

### Other Endpoints

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/extract-trip-info` | POST | No | NLP trip extraction |
| `/images/city/{name}` | GET | No | Get city images |
| `/images/city/{name}/hero` | GET | No | Get hero image |
| `/healthz` | GET | No | Health check |

---

## Database Schema Details

### DynamoDB Tables

#### 1. tripy-trips
```
Primary Key: tripId (String)

Attributes:
- tripId: String (UUID)
- createdBy: String (user_id)
- title: String
- startDate: String (YYYY-MM-DD)
- endDate: String (YYYY-MM-DD)
- inviteCode: String (8 chars, unique)
- status: String ("active" | "completed")
- includeHotels: Boolean
- maxBudget: Number
- durationDays: Number
- createdAt: String (ISO timestamp)
- updatedAt: String (ISO timestamp)

GSI: createdBy-index
  PK: createdBy
  SK: createdAt

GSI: inviteCode-index
  PK: inviteCode
```

#### 2. tripy-destinations
```
Primary Key: tripId (String), destinationId (String)

Attributes:
- tripId: String
- destinationId: String (UUID)
- name: String
- mustInclude: Boolean
- excluded: Boolean
- isStart: Boolean
- isEnd: Boolean
- createdBy: String
- createdAt: String
```

#### 3. tripy-itineraries
```
Primary Key: tripId (String), itemId (String)

Attributes:
- tripId: String
- itemId: String
- type: String ("path" | "payments" | "totals" | "itinerary_smart_tips" | etc.)
- [varies by type]
- createdAt: String
```

#### 4. tripy-points
```
Primary Key: tripId (String), SK (String = "{userId}#{program}")

Attributes:
- tripId: String
- userId: String
- program: String
- balance: Number
- updatedAt: String
```

#### 5. tripy-trip-members
```
Primary Key: tripId (String), userId (String)

Attributes:
- tripId: String
- userId: String
- role: String ("admin" | "member")
- status: String ("active" | "invited")
- joinedAt: String
```

#### 6. tripy-users
```
Primary Key: userId (String)

Attributes:
- userId: String (Cognito sub)
- email: String
- name: String
- default_home_airport: String
- timezone: String
- total_savings: Number
- credit_cards: List<{id, program, points, card_product}>
- createdAt: String
- updatedAt: String
```

#### 7. tripy-city-images
```
Primary Key: city_name (String)

Attributes:
- city_name: String (lowercase)
- images: List<String> (S3/CloudFront URLs)
- country: String
- region: String
- curatedAt: String
- status: String ("curated" | "coming_soon")
```

---

## Deployment Strategy

### Environment Variables

```bash
# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=xxx
AWS_SECRET_ACCESS_KEY=xxx

# Cognito
COGNITO_USER_POOL_ID=xxx
COGNITO_CLIENT_ID=xxx
COGNITO_CLIENT_SECRET=xxx

# External APIs
AWARDTOOL_API_KEY=xxx
SERPAPI_API_KEY=xxx
AMADEUS_CLIENT_ID=xxx
AMADEUS_CLIENT_SECRET=xxx
OPENAI_API_KEY=xxx

# Application
CORS_ORIGINS=https://tripy.app,https://www.tripy.app
LOG_LEVEL=INFO
```

### Deployment Targets

| Component | Service | Configuration |
|-----------|---------|---------------|
| Backend API | AWS App Runner | `apprunner.yaml` |
| Background Tasks | AWS Lambda | `lambda_handler.py` |
| Frontend | AWS Amplify | `amplify.yml` |
| Infrastructure | AWS CDK | `infra/` |

### CI/CD Pipeline

```yaml
# Simplified workflow
name: Deploy

on:
  push:
    branches: [main]

jobs:
  deploy-backend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to App Runner
        run: |
          aws apprunner update-service \
            --service-arn ${{ secrets.APP_RUNNER_ARN }} \
            --source-configuration ...

  deploy-frontend:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to Amplify
        run: aws amplify start-job --app-id ${{ secrets.AMPLIFY_APP_ID }} --branch-name main --job-type RELEASE
```

---

## Testing Strategy

### Unit Tests

```python
# test_points_maximizer.py
def test_single_traveler_optimal_path():
    """Test basic path optimization for single traveler."""
    edges = {
        ("JFK", "CDG", "AF001"): {"cash_cost": 800, "points_cost": 50000, ...},
        ("JFK", "CDG", "UA123"): {"cash_cost": 900, "points_cost": 40000, ...},
    }
    travelers = ["user1"]
    points = {"user1": {"chase": 60000}}
    
    solution = plan_maximize_points_value(...)
    
    assert solution["status"] == "Optimal"
    assert solution["path"]["user1"] == ["JFK", "CDG"]

def test_multi_traveler_cost_allocation():
    """Test cost allocation across multiple travelers."""
    ...

def test_must_visit_cities_constraint():
    """Test that must-visit cities are all included."""
    ...

def test_budget_constraint_respected():
    """Test that cash budget is not exceeded."""
    ...
```

### Integration Tests

```python
# test_itinerary_service.py
@pytest.mark.asyncio
async def test_generate_optimized_itinerary_e2e():
    """End-to-end itinerary generation test."""
    # Create trip
    trip = trip_service.create_trip(user_id, "Test Trip", "2025-06-01", "2025-06-10")
    
    # Add destinations
    destination_service.add_destination(trip["tripId"], user_id, "Paris", is_start=True)
    destination_service.add_destination(trip["tripId"], user_id, "Tokyo")
    destination_service.add_destination(trip["tripId"], user_id, "Miami", is_end=True)
    
    # Add points
    points_service.upsert_points(trip["tripId"], user_id, "chase", 200000)
    
    # Generate itinerary
    result = await itinerary_service.generate_optimized_itinerary(trip["tripId"])
    
    assert result["status"] == "Optimal"
    assert "path" in result["solution"]
    assert "pay_mode" in result["solution"]
```

### API Tests

```python
# test_api.py
def test_create_trip_endpoint():
    response = client.post("/trips", json={
        "title": "Test Trip",
        "start_date": "2025-06-01",
        "end_date": "2025-06-10",
    }, headers={"Authorization": f"Bearer {token}"})
    
    assert response.status_code == 200
    assert "tripId" in response.json()

def test_generate_itinerary_endpoint():
    response = client.post("/itinerary/generate", json={
        "trip_id": trip_id,
    }, headers={"Authorization": f"Bearer {token}"})
    
    assert response.status_code == 200
    assert "status" in response.json()
```

---

## Summary

This implementation plan covers:

1. **Core Backend Services** - All complete and functional
2. **External API Integration** - AwardTool, SerpAPI, Amadeus, OpenAI all integrated
3. **ILP Optimization Engine** - Full points maximization with multi-traveler support
4. **Group Trip Features** - Invites, voting, basic cost allocation
5. **Production Hardening** - Error handling complete, caching needs work
6. **Advanced Features** - Future enhancements outlined

**Key Strengths of Current Implementation:**
- Robust ILP optimizer that maximizes points value
- Multiple fallback strategies for edge cases
- Comprehensive transfer partner coverage
- Card benefits integration for bag fee savings
- OpenAI-powered suggestions for unsupported routes

**Areas for Enhancement:**
- Caching layer for external API responses
- Rate limiting for API calls
- Enhanced cost splitting for group trips
- Real-time award tracking
- Unified flight+hotel optimization

The frontend is production-ready. The backend requires minimal additional work for basic deployment, with optional enhancements for scalability and advanced features.

---

*Document Version: 1.0*
*Last Updated: January 2026*
