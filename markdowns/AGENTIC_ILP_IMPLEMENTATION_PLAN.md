# Agentic ILP Architecture Implementation Plan

## Executive Summary

This document outlines the implementation of an **agentic architecture** where AI agents orchestrate multiple API queries, feed structured data into an ILP (Integer Linear Programming) optimizer, rank results by **least out-of-pocket expense**, and use a dedicated agent to break down cost transactions.

**Supported Use Cases:**
- Solo trips (single traveler, multi-city)
- Group trips (multiple travelers, meetup cities, cost splitting)
- Hotels (award + cash, multiple programs)
- Cabin classes (Economy, Premium Economy, Business, First)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              USER REQUEST                                        │
│  (origin, destinations, dates, travelers, points, budget, preferences)          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         🤖 ORCHESTRATOR AGENT (OpenAI)                          │
│  - Parses user intent                                                           │
│  - Plans API query strategy                                                     │
│  - Coordinates specialist agents                                                │
│  - Handles errors and retries                                                   │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    ▼                 ▼                 ▼
┌───────────────────────┐ ┌───────────────────────┐ ┌───────────────────────┐
│  🛫 FLIGHT AGENT      │ │  🏨 HOTEL AGENT       │ │  🔍 SEARCH AGENT      │
│  (Agentic - OpenAI)   │ │  (Agentic - OpenAI)   │ │  (Deterministic)      │
│                       │ │                       │ │                       │
│  - AwardTool API      │ │  - AwardTool Hotels   │ │  - Amadeus API        │
│  - SerpAPI Flights    │ │  - SerpAPI Hotels     │ │  - Airport lookup     │
│  - Program selection  │ │  - Program selection  │ │  - City resolution    │
│  - Cabin class filter │ │  - Star rating filter │ │  - Hub identification │
└───────────────────────┘ └───────────────────────┘ └───────────────────────┘
                    │                 │                 │
                    └─────────────────┼─────────────────┘
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         📊 DATA NORMALIZER                                      │
│  - Unifies flight/hotel data formats                                            │
│  - Builds edge graph for ILP                                                    │
│  - Calculates CPP for each option                                               │
│  - Filters invalid/unavailable options                                          │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         ⚡ ILP OPTIMIZER (PuLP/CBC)                             │
│  - Minimizes out-of-pocket expense                                              │
│  - Respects budget constraints                                                  │
│  - Handles points transfers                                                     │
│  - Supports group cost splitting                                                │
│  - Optimizes cabin class selection                                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                         📋 RANKING ENGINE                                       │
│  - Ranks itineraries by OOP (out-of-pocket)                                     │
│  - Calculates savings percentage                                                │
│  - Computes value metrics (CPP, total savings)                                  │
│  - Generates top 3-5 options                                                    │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                     🤖 COST BREAKDOWN AGENT (OpenAI)                            │
│  - Explains each transaction                                                    │
│  - Generates transfer instructions                                              │
│  - Creates payment allocation for groups                                        │
│  - Produces human-readable summaries                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              FINAL RESPONSE                                     │
│  - Ranked itineraries                                                           │
│  - Per-segment cost breakdown                                                   │
│  - Transfer instructions                                                        │
│  - Booking links                                                                │
│  - Group settlement summary                                                     │
└─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Agent Definitions

### 1. Orchestrator Agent (Primary - Agentic)

**Purpose:** Coordinates the entire optimization pipeline, makes decisions about which APIs to query, handles errors, and manages retries.

**Model:** OpenAI GPT-4o (function calling)

**Capabilities:**
- Parse natural language trip requests
- Determine trip type (solo vs group)
- Plan parallel API queries
- Handle partial failures gracefully
- Decide when to use fallbacks

**Function Tools Available:**

```python
ORCHESTRATOR_TOOLS = [
    {
        "name": "search_flights",
        "description": "Search for flights using Flight Agent",
        "parameters": {
            "origin": "string",
            "destination": "string", 
            "date": "string (YYYY-MM-DD)",
            "cabin_classes": "array of strings",
            "travelers": "integer",
            "include_award": "boolean",
            "include_cash": "boolean"
        }
    },
    {
        "name": "search_hotels",
        "description": "Search for hotels using Hotel Agent",
        "parameters": {
            "city": "string",
            "check_in": "string (YYYY-MM-DD)",
            "check_out": "string (YYYY-MM-DD)",
            "guests": "integer",
            "star_ratings": "array of integers",
            "include_award": "boolean",
            "include_cash": "boolean"
        }
    },
    {
        "name": "resolve_location",
        "description": "Resolve city/airport codes using Search Agent",
        "parameters": {
            "query": "string",
            "type": "city | airport"
        }
    },
    {
        "name": "run_optimization",
        "description": "Run ILP optimization on collected data",
        "parameters": {
            "flight_data": "array",
            "hotel_data": "array",
            "user_points": "object",
            "budget": "number",
            "optimization_mode": "oop | cpp"
        }
    },
    {
        "name": "generate_cost_breakdown",
        "description": "Generate detailed cost breakdown using Cost Agent",
        "parameters": {
            "itinerary": "object",
            "travelers": "array"
        }
    }
]
```

---

### 2. Flight Agent (Agentic)

**Purpose:** Intelligently queries flight APIs, selects optimal programs to search, and handles cabin class preferences.

**Model:** OpenAI GPT-4o-mini (cost-effective for structured tasks)

**APIs Used:**
- AwardTool API (award flights)
- SerpAPI Google Flights (cash prices)

**Decision Logic:**

```python
class FlightAgentDecisions:
    """Decisions the Flight Agent makes autonomously."""
    
    def select_award_programs(self, route: str, user_points: dict) -> list[str]:
        """
        Select which award programs to search based on:
        - User's available points/miles
        - Route coverage (which programs fly this route)
        - Historical redemption value
        - Surcharge expectations
        """
        pass
    
    def determine_search_strategy(self, origin: str, dest: str) -> str:
        """
        Decide search strategy:
        - 'direct': Search direct flights only
        - 'connections': Include 1-stop connections
        - 'hub_routing': Route through major hubs
        - 'partner_search': Search partner programs
        """
        pass
    
    def select_cabin_priorities(self, budget: float, trip_type: str) -> list[str]:
        """
        Prioritize cabin classes based on:
        - Budget constraints
        - Trip duration
        - User preferences
        - Award availability patterns
        """
        pass
```

**Parallel Query Strategy:**

```python
async def flight_agent_search(request: FlightSearchRequest) -> FlightSearchResult:
    """
    Flight Agent orchestrates parallel API calls.
    """
    # Step 1: Determine which programs to search
    programs_to_search = await select_programs_with_llm(
        route=f"{request.origin}-{request.destination}",
        user_points=request.user_points,
        cabin_classes=request.cabin_classes
    )
    
    # Step 2: Build parallel query tasks
    tasks = []
    
    # Award searches (parallel by program)
    for program in programs_to_search:
        tasks.append(
            search_awardtool(
                origin=request.origin,
                destination=request.destination,
                date=request.date,
                programs=[program],
                cabins=request.cabin_classes
            )
        )
    
    # Cash search (parallel with award)
    for cabin in request.cabin_classes:
        tasks.append(
            search_serpapi_flights(
                origin=request.origin,
                destination=request.destination,
                date=request.date,
                travel_class=CABIN_TO_SERP[cabin]
            )
        )
    
    # Step 3: Execute in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Step 4: Handle failures, merge results
    return merge_flight_results(results)
```

---

### 3. Hotel Agent (Agentic)

**Purpose:** Searches hotel options across award and cash programs, matches user preferences for star ratings and locations.

**Model:** OpenAI GPT-4o-mini

**APIs Used:**
- AwardTool Hotels API (award nights)
- SerpAPI Google Hotels (cash rates)

**Decision Logic:**

```python
class HotelAgentDecisions:
    """Decisions the Hotel Agent makes autonomously."""
    
    def select_hotel_programs(self, city: str, user_points: dict) -> list[str]:
        """
        Select hotel programs to search:
        - HH (Hilton Honors)
        - MAR (Marriott Bonvoy)
        - HYATT (World of Hyatt)
        - IHG (IHG One Rewards)
        
        Based on:
        - User's hotel points balances
        - Program presence in city
        - Historical redemption values
        """
        pass
    
    def determine_star_strategy(self, budget: float, trip_purpose: str) -> list[int]:
        """
        Recommend star ratings based on:
        - Budget (higher budget = higher stars)
        - Trip purpose (business vs leisure)
        - City (some cities 4-star = 5-star elsewhere)
        """
        pass
```

**Search Implementation:**

```python
async def hotel_agent_search(request: HotelSearchRequest) -> HotelSearchResult:
    """
    Hotel Agent orchestrates parallel hotel API calls.
    """
    # Step 1: Determine programs to search
    programs = await select_hotel_programs_with_llm(
        city=request.city,
        user_points=request.user_points
    )
    
    # Step 2: Build parallel queries
    tasks = []
    
    # Award hotel searches
    for program in programs:
        tasks.append(
            search_awardtool_hotels(
                city=request.city,
                check_in=request.check_in,
                check_out=request.check_out,
                programs=[program],
                star_ratings=request.star_ratings
            )
        )
    
    # Cash hotel search
    tasks.append(
        search_serpapi_hotels(
            city=request.city,
            check_in=request.check_in,
            check_out=request.check_out,
            guests=request.guests
        )
    )
    
    # Step 3: Execute in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Step 4: Merge and deduplicate
    return merge_hotel_results(results)
```

---

### 4. Search Agent (Deterministic)

**Purpose:** Resolves locations, validates airports, identifies hubs for small airports.

**APIs Used:**
- Amadeus Airport/City Search
- OpenAI (fallback for ambiguous queries)

**Not agentic** - uses deterministic logic with LLM fallback only when needed.

```python
async def resolve_location(query: str, location_type: str) -> LocationResult:
    """
    Resolve a location query to standardized codes.
    """
    # Step 1: Try Amadeus first (fast, accurate)
    amadeus_result = await search_amadeus(query, location_type)
    if amadeus_result.confidence > 0.9:
        return amadeus_result
    
    # Step 2: Try CSV fallback (offline, comprehensive)
    csv_result = search_csv_airports(query)
    if csv_result:
        return csv_result
    
    # Step 3: OpenAI fallback (for ambiguous/international queries)
    return await search_with_openai(query, location_type)
```

---

### 5. Cost Breakdown Agent (Agentic)

**Purpose:** Generates human-readable cost breakdowns, transfer instructions, and group settlement summaries.

**Model:** OpenAI GPT-4o

**Input:** Optimized itinerary from ILP

**Output:**
- Per-segment cost breakdown
- Transfer instructions with portal URLs
- Group payment allocation
- Savings summary

**Implementation:**

```python
COST_BREAKDOWN_SYSTEM_PROMPT = """
You are a travel cost analyst. Given an optimized itinerary, generate:

1. **Per-Segment Breakdown**: For each flight/hotel, explain:
   - What's being booked
   - Payment method (cash or points)
   - If points: which program, how many, transfer instructions
   - If cash: exact amount
   - Surcharges and taxes

2. **Transfer Instructions**: For each points transfer:
   - Source program (e.g., Chase Ultimate Rewards)
   - Target program (e.g., United MileagePlus)
   - Transfer ratio
   - Portal URL
   - Estimated transfer time
   - Step-by-step instructions

3. **Group Settlement** (if applicable):
   - Who pays for what
   - Points contributions valued at market rate
   - Cash contributions
   - Net settlements between members

4. **Savings Summary**:
   - Total cash price (if paid all cash)
   - Total out-of-pocket
   - Total savings
   - Average CPP achieved

Output in structured JSON format.
"""

async def generate_cost_breakdown(
    itinerary: OptimizedItinerary,
    travelers: list[Traveler]
) -> CostBreakdown:
    """
    Use LLM to generate detailed, human-readable cost breakdown.
    """
    response = await openai_client.chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": COST_BREAKDOWN_SYSTEM_PROMPT},
            {"role": "user", "content": json.dumps({
                "itinerary": itinerary.model_dump(),
                "travelers": [t.model_dump() for t in travelers],
                "transfer_graph": TRANSFER_GRAPH,
            })}
        ],
        response_format={"type": "json_object"}
    )
    
    return CostBreakdown.model_validate_json(response.choices[0].message.content)
```

---

## Data Flow & Schemas

### 1. Unified Flight Option Schema

```python
class FlightOption(BaseModel):
    """Unified schema for flight options from any source."""
    
    # Identity
    id: str                           # Unique identifier
    source: Literal["awardtool", "serpapi", "dummy"]
    
    # Route
    origin: str                       # IATA code
    destination: str                  # IATA code
    departure_time: datetime
    arrival_time: datetime
    duration_minutes: int
    stops: int
    
    # Flight details
    airline: str                      # Marketing carrier
    operating_airline: str            # Operating carrier
    flight_numbers: list[str]
    aircraft: list[str]
    
    # Cabin
    cabin_class: Literal["Economy", "Premium Economy", "Business", "First"]
    
    # Pricing - Cash
    cash_price: float | None          # USD
    
    # Pricing - Award
    award_program: str | None         # e.g., "UA", "AA"
    award_points: int | None          # Miles/points required
    award_surcharge: float | None     # Cash surcharge
    award_available: bool
    
    # Calculated
    cpp: float | None                 # Cents per point value
    oop_if_award: float | None        # Out-of-pocket if using award
    
    # Metadata
    booking_url: str | None
    seats_remaining: int | None


class FlightSearchResult(BaseModel):
    """Result from Flight Agent search."""
    
    origin: str
    destination: str
    date: str
    
    options: list[FlightOption]
    
    # Metadata
    programs_searched: list[str]
    cabins_searched: list[str]
    search_duration_ms: int
    errors: list[str]
```

### 2. Unified Hotel Option Schema

```python
class HotelOption(BaseModel):
    """Unified schema for hotel options from any source."""
    
    # Identity
    id: str
    source: Literal["awardtool", "serpapi", "dummy"]
    
    # Property
    name: str
    brand: str | None                 # e.g., "Hilton", "Marriott"
    star_rating: int                  # 1-5
    address: str
    city: str
    
    # Dates
    check_in: date
    check_out: date
    nights: int
    
    # Room
    room_type: str
    guests: int
    
    # Pricing - Cash
    cash_price_per_night: float | None
    cash_price_total: float | None
    
    # Pricing - Award
    award_program: str | None         # e.g., "HH", "MAR"
    award_points_per_night: int | None
    award_points_total: int | None
    award_surcharge: float | None     # Taxes/fees
    award_available: bool
    
    # Calculated
    cpp: float | None
    oop_if_award: float | None
    
    # Metadata
    booking_url: str | None
    amenities: list[str]


class HotelSearchResult(BaseModel):
    """Result from Hotel Agent search."""
    
    city: str
    check_in: str
    check_out: str
    
    options: list[HotelOption]
    
    programs_searched: list[str]
    star_ratings_searched: list[int]
    search_duration_ms: int
    errors: list[str]
```

### 3. ILP Input Schema

```python
class ILPInput(BaseModel):
    """Structured input for ILP optimizer."""
    
    # Trip structure
    trip_type: Literal["solo", "group"]
    travelers: list[str]
    
    # Routes
    segments: list[TripSegment]       # Ordered list of segments
    
    # Options per segment
    flight_options: dict[str, list[FlightOption]]  # segment_id -> options
    hotel_options: dict[str, list[HotelOption]]    # segment_id -> options
    
    # User resources
    user_points: dict[str, dict[str, int]]  # traveler -> program -> balance
    user_budgets: dict[str, float]          # traveler -> max cash budget
    
    # Transfer graph
    transfer_paths: list[TransferPath]
    
    # Constraints
    optimization_mode: Literal["oop", "cpp"]
    min_cpp_threshold: float
    max_surcharge_ratio: float
    
    # Group-specific
    can_pay_for: dict[str, list[str]] | None  # who can pay for whom
    meetup_cities: list[str] | None


class TripSegment(BaseModel):
    """A segment of the trip (flight or hotel stay)."""
    
    id: str
    type: Literal["flight", "hotel"]
    
    # For flights
    origin: str | None
    destination: str | None
    date: str | None
    
    # For hotels
    city: str | None
    check_in: str | None
    check_out: str | None
    
    # Traveler assignment
    travelers: list[str]              # Which travelers need this segment
    
    # Preferences
    cabin_classes: list[str] | None   # For flights
    star_ratings: list[int] | None    # For hotels
```

### 4. ILP Output Schema

```python
class ILPOutput(BaseModel):
    """Output from ILP optimizer."""
    
    status: Literal["optimal", "feasible", "infeasible", "error"]
    
    # Selected options per segment
    selections: list[SegmentSelection]
    
    # Totals
    totals: TripTotals
    
    # Ranking score (lower = better for OOP)
    oop_score: float


class SegmentSelection(BaseModel):
    """Selected option for a segment."""
    
    segment_id: str
    segment_type: Literal["flight", "hotel"]
    
    # Selected option
    option_id: str
    option_details: FlightOption | HotelOption
    
    # Payment
    payment_method: Literal["cash", "points"]
    
    # If cash
    cash_amount: float | None
    payer: str | None
    
    # If points
    points_program: str | None
    points_amount: int | None
    points_surcharge: float | None
    points_source: str | None         # Bank program for transfer
    transfer_required: bool
    transfer_ratio: float | None
    payer: str | None
    
    # Value metrics
    cpp_achieved: float | None
    cash_saved: float | None


class TripTotals(BaseModel):
    """Total costs and savings for the trip."""
    
    # Cash
    total_cash_price: float           # If everything paid cash
    total_out_of_pocket: float        # Actual cash to pay
    total_cash_saved: float
    savings_percentage: float
    
    # Points
    total_points_used: int
    points_breakdown: dict[str, int]  # program -> points used
    average_cpp: float
    
    # Time
    total_travel_time_minutes: int
    total_hotel_nights: int
    
    # Group (if applicable)
    per_traveler_oop: dict[str, float]
    settlements: list[Settlement] | None
```

---

## ILP Formulation for OOP Minimization

### Decision Variables

```python
# For each segment s, option o, traveler t, payment method m:
x[s, o, t, m] ∈ {0, 1}  # 1 if option o selected for segment s, traveler t, payment m

# For point transfers:
transfer[t, source, target] ≥ 0  # Points transferred from source to target for traveler t
```

### Objective Function (OOP Minimization)

```python
Minimize:
    Σ (cash_cost[s, o] * x[s, o, t, "cash"])           # Cash payments
  + Σ (surcharge[s, o] * x[s, o, t, "points"])        # Award surcharges
  - W_savings * Σ (cash_saved[s, o] * x[s, o, t, "points"])  # Bonus for using points
```

### Constraints

```python
# 1. Each segment must have exactly one selection per traveler
∀s, t: Σ_o,m x[s, o, t, m] = 1

# 2. Points balance constraints
∀t, program: 
    points_used[t, program] ≤ balance[t, program] + transfers_in[t, program]

# 3. Transfer ratio constraints  
∀t, source, target:
    miles_received[t, target] = transfer[t, source, target] * ratio[source, target]

# 4. Budget constraints
∀t: total_cash[t] ≤ budget[t]

# 5. CPP threshold (OOP mode: 0.5, CPP mode: 1.0+)
∀s, o, t where payment = "points":
    cpp[s, o] ≥ min_cpp_threshold OR x[s, o, t, "points"] = 0

# 6. Surcharge ratio constraint
∀s, o where surcharge_ratio > 0.5:
    x[s, o, t, "points"] = 0

# 7. Cabin class preference (soft constraint)
∀s, o where cabin[o] = preferred_cabin:
    bonus[s, o] = cabin_preference_weight

# 8. Group meetup constraints (if applicable)
∀meetup_city, t1, t2:
    arrival_time[t1, meetup_city] compatible with arrival_time[t2, meetup_city]
```

### Ranking by OOP

After solving, rank all feasible solutions by:

```python
def rank_itineraries(solutions: list[ILPOutput]) -> list[RankedItinerary]:
    """
    Rank solutions by out-of-pocket expense.
    """
    ranked = []
    
    for solution in solutions:
        ranked.append(RankedItinerary(
            solution=solution,
            rank_score=solution.totals.total_out_of_pocket,
            savings_score=solution.totals.savings_percentage,
            value_score=solution.totals.average_cpp,
        ))
    
    # Sort by OOP (ascending) - lowest OOP first
    ranked.sort(key=lambda x: x.rank_score)
    
    return ranked
```

---

## Implementation Phases

### Phase 1: Agent Infrastructure

#### 1.1 Create Agent Base Classes

**File: `backend/src/agents/base.py`**

```python
from abc import ABC, abstractmethod
from typing import Any, TypeVar, Generic
from pydantic import BaseModel
import openai

T = TypeVar("T", bound=BaseModel)
R = TypeVar("R", bound=BaseModel)


class AgentConfig(BaseModel):
    """Configuration for an agent."""
    model: str = "gpt-4o-mini"
    temperature: float = 0.1
    max_retries: int = 3
    timeout_seconds: int = 30


class BaseAgent(ABC, Generic[T, R]):
    """Base class for all agents."""
    
    def __init__(self, config: AgentConfig = None):
        self.config = config or AgentConfig()
        self.client = openai.AsyncOpenAI()
    
    @property
    @abstractmethod
    def system_prompt(self) -> str:
        """System prompt for the agent."""
        pass
    
    @property
    @abstractmethod
    def tools(self) -> list[dict]:
        """Function tools available to the agent."""
        pass
    
    @abstractmethod
    async def execute(self, request: T) -> R:
        """Execute the agent's task."""
        pass
    
    async def _call_llm(self, messages: list[dict]) -> Any:
        """Call the LLM with function calling."""
        response = await self.client.chat.completions.create(
            model=self.config.model,
            messages=messages,
            tools=self.tools if self.tools else None,
            temperature=self.config.temperature,
        )
        return response
    
    async def _execute_tool(self, tool_name: str, arguments: dict) -> Any:
        """Execute a tool call."""
        tool_map = self._get_tool_map()
        if tool_name not in tool_map:
            raise ValueError(f"Unknown tool: {tool_name}")
        return await tool_map[tool_name](**arguments)
    
    @abstractmethod
    def _get_tool_map(self) -> dict[str, callable]:
        """Map tool names to implementations."""
        pass
```

#### 1.2 Implement Flight Agent

**File: `backend/src/agents/flight_agent.py`**

```python
from .base import BaseAgent, AgentConfig
from ..models.flights import FlightSearchRequest, FlightSearchResult, FlightOption
from ..handlers.flights import search_awardtool_flights
from ..services.serp_api_functions import search_google_flights
import asyncio


class FlightAgent(BaseAgent[FlightSearchRequest, FlightSearchResult]):
    """Agentic flight search with intelligent program selection."""
    
    @property
    def system_prompt(self) -> str:
        return """You are a flight search specialist. Your job is to:
1. Analyze the route and user's points to select optimal award programs
2. Execute parallel searches across multiple APIs
3. Merge results and identify best options

Consider:
- Which programs have good availability on this route
- Transfer partners for the user's bank points
- Surcharge patterns (avoid BA/LH for high surcharges)
- Cabin class availability patterns

Return structured decisions for the search strategy."""
    
    @property
    def tools(self) -> list[dict]:
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_award_flights",
                    "description": "Search for award flights using AwardTool API",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "origin": {"type": "string"},
                            "destination": {"type": "string"},
                            "date": {"type": "string"},
                            "programs": {"type": "array", "items": {"type": "string"}},
                            "cabins": {"type": "array", "items": {"type": "string"}}
                        },
                        "required": ["origin", "destination", "date", "programs", "cabins"]
                    }
                }
            },
            {
                "type": "function", 
                "function": {
                    "name": "search_cash_flights",
                    "description": "Search for cash flights using SerpAPI",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "origin": {"type": "string"},
                            "destination": {"type": "string"},
                            "date": {"type": "string"},
                            "cabin_class": {"type": "integer", "description": "1=Economy, 2=Premium, 3=Business, 4=First"}
                        },
                        "required": ["origin", "destination", "date", "cabin_class"]
                    }
                }
            }
        ]
    
    async def execute(self, request: FlightSearchRequest) -> FlightSearchResult:
        """Execute flight search with agentic decision-making."""
        
        # Step 1: Get LLM to decide search strategy
        strategy = await self._get_search_strategy(request)
        
        # Step 2: Execute parallel searches based on strategy
        tasks = []
        
        for program in strategy.programs:
            tasks.append(self._search_award(
                request.origin, request.destination, request.date,
                [program], request.cabin_classes
            ))
        
        for cabin in request.cabin_classes:
            tasks.append(self._search_cash(
                request.origin, request.destination, request.date, cabin
            ))
        
        # Step 3: Gather results
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Step 4: Merge and normalize
        return self._merge_results(results, request)
    
    async def _get_search_strategy(self, request: FlightSearchRequest) -> SearchStrategy:
        """Use LLM to determine optimal search strategy."""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": f"""
Route: {request.origin} → {request.destination}
Date: {request.date}
User Points: {request.user_points}
Cabin Preferences: {request.cabin_classes}

Decide which award programs to search and why.
Return JSON: {{"programs": ["UA", "AA", ...], "reasoning": "..."}}
"""}
        ]
        
        response = await self._call_llm(messages)
        return SearchStrategy.model_validate_json(response.choices[0].message.content)
```

#### 1.3 Implement Hotel Agent

**File: `backend/src/agents/hotel_agent.py`**

```python
class HotelAgent(BaseAgent[HotelSearchRequest, HotelSearchResult]):
    """Agentic hotel search with intelligent program selection."""
    
    @property
    def system_prompt(self) -> str:
        return """You are a hotel search specialist. Your job is to:
1. Select optimal hotel programs based on user's points and city
2. Execute parallel searches for award and cash options
3. Match results to user's star rating preferences

Consider:
- Program presence in the city (Hyatt strong in some cities, Marriott in others)
- Points value (Hyatt typically best CPP, Hilton lowest)
- User's existing balances and transfer options

Return structured decisions for the search strategy."""
    
    # Similar implementation to FlightAgent...
```

#### 1.4 Implement Cost Breakdown Agent

**File: `backend/src/agents/cost_breakdown_agent.py`**

```python
class CostBreakdownAgent(BaseAgent[OptimizedItinerary, CostBreakdown]):
    """Generates detailed, human-readable cost breakdowns."""
    
    @property
    def system_prompt(self) -> str:
        return """You are a travel finance analyst. Given an optimized itinerary, generate:

1. Per-Segment Breakdown:
   - Description of what's booked
   - Payment method with details
   - Points transfer instructions if applicable
   - Exact costs and savings

2. Transfer Instructions:
   - Step-by-step for each transfer
   - Portal URLs and timing
   - Best practices (transfer in advance, etc.)

3. Group Settlement (if applicable):
   - Clear "X owes Y $Z" statements
   - Points contributions valued fairly
   - Simple settlement plan

4. Summary:
   - Total savings vs all-cash
   - Value achieved (CPP)
   - Key recommendations

Be precise with numbers. Use clear, friendly language."""
    
    async def execute(self, itinerary: OptimizedItinerary) -> CostBreakdown:
        """Generate cost breakdown."""
        messages = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": json.dumps({
                "itinerary": itinerary.model_dump(),
                "transfer_graph": self._get_transfer_graph(),
            })}
        ]
        
        response = await self.client.chat.completions.create(
            model="gpt-4o",  # Use stronger model for complex reasoning
            messages=messages,
            response_format={"type": "json_object"}
        )
        
        return CostBreakdown.model_validate_json(
            response.choices[0].message.content
        )
```

---

### Phase 2: Orchestrator Implementation

**File: `backend/src/agents/orchestrator.py`**

```python
class OrchestratorAgent:
    """
    Main orchestrator that coordinates all agents and the ILP optimizer.
    """
    
    def __init__(self):
        self.flight_agent = FlightAgent()
        self.hotel_agent = HotelAgent()
        self.search_agent = SearchAgent()
        self.cost_agent = CostBreakdownAgent()
        self.ilp_optimizer = ILPOptimizer()
    
    async def optimize_trip(
        self,
        request: TripRequest
    ) -> list[RankedItinerary]:
        """
        Main entry point for trip optimization.
        
        1. Parse and validate request
        2. Orchestrate parallel API searches via agents
        3. Build ILP input
        4. Run optimization
        5. Rank by OOP
        6. Generate cost breakdowns
        """
        
        # Step 1: Resolve all locations
        locations = await self._resolve_locations(request)
        
        # Step 2: Build segment list
        segments = self._build_segments(request, locations)
        
        # Step 3: Search flights and hotels in parallel
        search_tasks = []
        
        for segment in segments:
            if segment.type == "flight":
                search_tasks.append(
                    self.flight_agent.execute(FlightSearchRequest(
                        origin=segment.origin,
                        destination=segment.destination,
                        date=segment.date,
                        cabin_classes=segment.cabin_classes or ["Economy", "Business"],
                        user_points=request.user_points,
                    ))
                )
            elif segment.type == "hotel":
                search_tasks.append(
                    self.hotel_agent.execute(HotelSearchRequest(
                        city=segment.city,
                        check_in=segment.check_in,
                        check_out=segment.check_out,
                        star_ratings=segment.star_ratings or [4, 5],
                        user_points=request.user_points,
                    ))
                )
        
        # Execute all searches in parallel
        search_results = await asyncio.gather(*search_tasks, return_exceptions=True)
        
        # Step 4: Build ILP input
        ilp_input = self._build_ilp_input(
            request=request,
            segments=segments,
            search_results=search_results,
        )
        
        # Step 5: Run ILP optimization
        ilp_outputs = await self.ilp_optimizer.solve(ilp_input)
        
        # Step 6: Rank by OOP (lowest first)
        ranked = self._rank_by_oop(ilp_outputs)
        
        # Step 7: Generate cost breakdowns for top 5
        top_results = []
        for itinerary in ranked[:5]:
            breakdown = await self.cost_agent.execute(itinerary)
            top_results.append(RankedItinerary(
                itinerary=itinerary,
                cost_breakdown=breakdown,
                rank=len(top_results) + 1,
            ))
        
        return top_results
    
    def _rank_by_oop(self, outputs: list[ILPOutput]) -> list[ILPOutput]:
        """Rank solutions by out-of-pocket expense (ascending)."""
        return sorted(outputs, key=lambda x: x.totals.total_out_of_pocket)
```

---

### Phase 3: Support All Trip Types

#### 3.1 Solo Trip Support

```python
class SoloTripRequest(BaseModel):
    """Request for solo trip optimization."""
    
    traveler_id: str
    
    # Route
    origin: str
    destinations: list[str]          # Intermediate stops
    final_destination: str | None    # If different from origin (one-way)
    
    # Dates
    departure_date: date
    return_date: date | None
    nights_per_destination: dict[str, int]  # city -> nights
    
    # Resources
    points: dict[str, int]           # program -> balance
    budget: float
    
    # Preferences
    cabin_classes: list[str]
    hotel_star_ratings: list[int]
    
    # Optimization
    optimization_mode: Literal["oop", "cpp"] = "oop"
```

#### 3.2 Group Trip Support

```python
class GroupTripRequest(BaseModel):
    """Request for group trip optimization."""
    
    trip_id: str
    
    # Travelers
    travelers: list[TravelerInfo]
    
    # Route (potentially different start points)
    traveler_origins: dict[str, str]  # traveler_id -> origin
    destinations: list[str]
    meetup_city: str                  # Where everyone meets
    final_destinations: dict[str, str] | None  # Where each person ends
    
    # Dates
    trip_start: date
    trip_end: date
    
    # Resources (per traveler)
    points: dict[str, dict[str, int]]  # traveler -> program -> balance
    budgets: dict[str, float]          # traveler -> budget
    
    # Cost splitting
    can_pay_for: dict[str, list[str]]  # who can pay for whom
    split_method: Literal["equal", "by_usage", "custom"]
    
    # Preferences
    cabin_classes: list[str]
    hotel_star_ratings: list[int]
    
    optimization_mode: Literal["oop", "cpp"] = "oop"


class TravelerInfo(BaseModel):
    traveler_id: str
    name: str
    email: str | None
```

#### 3.3 Cabin Class Support

```python
CABIN_CLASSES = {
    "Economy": {
        "serpapi_code": 1,
        "awardtool_name": "Economy",
        "display_name": "Economy",
        "typical_cpp_range": (0.8, 1.5),
    },
    "Premium Economy": {
        "serpapi_code": 2,
        "awardtool_name": "Premium Economy",
        "display_name": "Premium Economy",
        "typical_cpp_range": (1.0, 2.0),
    },
    "Business": {
        "serpapi_code": 3,
        "awardtool_name": "Business",
        "display_name": "Business Class",
        "typical_cpp_range": (1.5, 3.0),
    },
    "First": {
        "serpapi_code": 4,
        "awardtool_name": "First",
        "display_name": "First Class",
        "typical_cpp_range": (2.0, 5.0),
    },
}
```

#### 3.4 Hotel Type Support

```python
HOTEL_PROGRAMS = {
    "HH": {
        "name": "Hilton Honors",
        "typical_cpp": 0.5,
        "transfer_partners": ["amex"],
        "transfer_ratios": {"amex": 2.0},  # 1 MR = 2 HH
    },
    "MAR": {
        "name": "Marriott Bonvoy",
        "typical_cpp": 0.8,
        "transfer_partners": ["amex", "chase"],
        "transfer_ratios": {"amex": 1.0, "chase": 1.0},
    },
    "HYATT": {
        "name": "World of Hyatt",
        "typical_cpp": 1.8,
        "transfer_partners": ["chase", "bilt"],
        "transfer_ratios": {"chase": 1.0, "bilt": 1.0},
    },
    "IHG": {
        "name": "IHG One Rewards",
        "typical_cpp": 0.5,
        "transfer_partners": ["chase"],
        "transfer_ratios": {"chase": 1.0},
    },
}

HOTEL_STAR_RATINGS = {
    3: "Mid-Range",
    4: "Upscale",
    5: "Luxury",
}
```

---

### Phase 4: API Endpoints

**File: `backend/src/routes/optimize.py`**

```python
from fastapi import APIRouter, HTTPException
from ..agents.orchestrator import OrchestratorAgent

router = APIRouter(prefix="/optimize", tags=["optimization"])

orchestrator = OrchestratorAgent()


@router.post("/solo")
async def optimize_solo_trip(request: SoloTripRequest) -> list[RankedItinerary]:
    """
    Optimize a solo trip.
    
    Uses agentic architecture to:
    1. Search flights and hotels via Flight/Hotel Agents
    2. Feed data into ILP optimizer
    3. Rank results by OOP (lowest out-of-pocket first)
    4. Generate cost breakdowns via Cost Agent
    """
    try:
        return await orchestrator.optimize_trip(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group")
async def optimize_group_trip(request: GroupTripRequest) -> list[RankedItinerary]:
    """
    Optimize a group trip.
    
    Additional handling for:
    - Multiple travelers with different origins
    - Points pooling across members
    - Cost splitting and settlement
    """
    try:
        return await orchestrator.optimize_trip(request)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/compare")
async def compare_strategies(request: TripRequest) -> StrategyComparison:
    """
    Compare OOP vs CPP optimization strategies.
    
    Returns both results with explanation of trade-offs.
    """
    oop_result = await orchestrator.optimize_trip(
        request.model_copy(update={"optimization_mode": "oop"})
    )
    cpp_result = await orchestrator.optimize_trip(
        request.model_copy(update={"optimization_mode": "cpp"})
    )
    
    return StrategyComparison(
        oop=oop_result[0],
        cpp=cpp_result[0],
        recommendation="oop",
        explanation=generate_comparison_explanation(oop_result[0], cpp_result[0]),
    )
```

---

## Implementation Checklist

### Phase 1: Agent Infrastructure
- [ ] Create `backend/src/agents/` directory
- [ ] Implement `base.py` with BaseAgent class
- [ ] Implement `flight_agent.py`
- [ ] Implement `hotel_agent.py`
- [ ] Implement `search_agent.py`
- [ ] Implement `cost_breakdown_agent.py`
- [ ] Add unit tests for each agent

### Phase 2: Orchestrator
- [ ] Implement `orchestrator.py`
- [ ] Add parallel execution logic
- [ ] Implement error handling and retries
- [ ] Add fallback strategies
- [ ] Integration tests for orchestrator

### Phase 3: ILP Optimizer Updates
- [ ] Update ILP to accept unified schemas
- [ ] Add cabin class handling to objective
- [ ] Add hotel optimization to ILP
- [ ] Implement OOP ranking
- [ ] Performance optimization

### Phase 4: Trip Type Support
- [ ] Solo trip request/response models
- [ ] Group trip request/response models
- [ ] Cabin class configuration
- [ ] Hotel program configuration
- [ ] Cost splitting logic

### Phase 5: API Endpoints
- [ ] `/optimize/solo` endpoint
- [ ] `/optimize/group` endpoint
- [ ] `/optimize/compare` endpoint
- [ ] Request validation
- [ ] Error handling

### Phase 6: Testing
- [ ] Unit tests for agents
- [ ] Integration tests for orchestrator
- [ ] End-to-end tests for API
- [ ] Performance benchmarks
- [ ] Load testing

---

## Cost Breakdown Output Example

```json
{
  "trip_summary": {
    "route": "JFK → Paris (3 nights) → Rome (2 nights) → JFK",
    "travelers": ["Alice"],
    "total_cash_price": 4250.00,
    "total_out_of_pocket": 845.00,
    "total_savings": 3405.00,
    "savings_percentage": 80.1
  },
  "segments": [
    {
      "segment": "JFK → CDG (Business)",
      "type": "flight",
      "cash_price": 2800.00,
      "payment": {
        "method": "points",
        "program": "Air France Flying Blue",
        "points_used": 55000,
        "surcharge": 95.00,
        "cpp_achieved": 4.92
      },
      "transfer": {
        "required": true,
        "from": "Chase Ultimate Rewards",
        "to": "Air France Flying Blue",
        "points_to_transfer": 55000,
        "ratio": "1:1",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "transfer_time": "Instant",
        "instructions": [
          "1. Log in to Chase Ultimate Rewards portal",
          "2. Click 'Transfer Points' → 'Air France Flying Blue'",
          "3. Enter 55,000 points",
          "4. Confirm transfer (instant)"
        ]
      }
    },
    {
      "segment": "Paris Hotel (3 nights, 5-star)",
      "type": "hotel",
      "hotel_name": "Park Hyatt Paris-Vendome",
      "cash_price": 1500.00,
      "payment": {
        "method": "points",
        "program": "World of Hyatt",
        "points_used": 30000,
        "surcharge": 0.00,
        "cpp_achieved": 5.00
      },
      "transfer": {
        "required": true,
        "from": "Chase Ultimate Rewards",
        "to": "World of Hyatt",
        "points_to_transfer": 30000,
        "ratio": "1:1",
        "portal_url": "https://ultimaterewardspoints.chase.com",
        "transfer_time": "Instant"
      }
    },
    {
      "segment": "CDG → FCO (Economy)",
      "type": "flight",
      "cash_price": 150.00,
      "payment": {
        "method": "cash",
        "amount": 150.00,
        "reason": "Low cash price; better to save points for premium redemptions"
      }
    },
    {
      "segment": "Rome Hotel (2 nights, 4-star)",
      "type": "hotel",
      "hotel_name": "Marriott Rome Grand Flora",
      "cash_price": 400.00,
      "payment": {
        "method": "cash",
        "amount": 400.00,
        "reason": "No Marriott points available; cash rate competitive"
      }
    },
    {
      "segment": "FCO → JFK (Economy)",
      "type": "flight",
      "cash_price": 400.00,
      "payment": {
        "method": "points",
        "program": "Delta SkyMiles",
        "points_used": 35000,
        "surcharge": 200.00,
        "cpp_achieved": 0.57
      },
      "transfer": {
        "required": true,
        "from": "Amex Membership Rewards",
        "to": "Delta SkyMiles",
        "points_to_transfer": 35000,
        "ratio": "1:1"
      }
    }
  ],
  "transfer_summary": {
    "total_transfers": 3,
    "by_source": {
      "Chase Ultimate Rewards": {
        "total_transferred": 85000,
        "destinations": ["Air France Flying Blue (55k)", "World of Hyatt (30k)"]
      },
      "Amex Membership Rewards": {
        "total_transferred": 35000,
        "destinations": ["Delta SkyMiles (35k)"]
      }
    },
    "recommended_order": [
      "1. Transfer Chase → Hyatt (instant, for hotel)",
      "2. Transfer Chase → Air France (instant, for outbound flight)",
      "3. Transfer Amex → Delta (instant, for return flight)"
    ],
    "timing_advice": "Complete all transfers 2-3 days before booking to ensure points post correctly."
  },
  "payment_breakdown": {
    "cash_payments": [
      {"item": "CDG → FCO flight", "amount": 150.00},
      {"item": "Rome hotel (2 nights)", "amount": 400.00},
      {"item": "JFK → CDG surcharge", "amount": 95.00},
      {"item": "FCO → JFK surcharge", "amount": 200.00}
    ],
    "total_cash": 845.00,
    "points_used": {
      "Air France Flying Blue": 55000,
      "World of Hyatt": 30000,
      "Delta SkyMiles": 35000
    },
    "total_points": 120000
  },
  "value_analysis": {
    "average_cpp": 2.84,
    "best_redemption": {
      "segment": "Paris Hotel",
      "cpp": 5.00,
      "program": "World of Hyatt"
    },
    "worst_redemption": {
      "segment": "FCO → JFK",
      "cpp": 0.57,
      "program": "Delta SkyMiles",
      "note": "Still better than cash due to OOP optimization"
    }
  }
}
```

---

## Success Metrics

| Metric | Target |
|--------|--------|
| API Response Time | < 15 seconds for full optimization |
| Search Parallelization | ≥ 80% of searches run in parallel |
| OOP Accuracy | Lowest OOP option ranked #1 in 95%+ cases |
| Cost Breakdown Completeness | 100% of transactions explained |
| Agent Fallback Rate | < 5% fallback to dummy data |
| Test Coverage | ≥ 90% for agent logic |

---

## Appendix: API Integration Details

### AwardTool API

| Endpoint | Purpose | Rate Limit |
|----------|---------|------------|
| `/search_real_time` | Award flight search | 100/min |
| `/search_hotel` | Award hotel search | 100/min |
| `/panorama/panorama_calendar_data` | Calendar availability | 50/min |

### SerpAPI

| Engine | Purpose | Rate Limit |
|--------|---------|------------|
| `google_flights` | Cash flight prices | 100/min |
| `google_hotels` | Cash hotel prices | 100/min |
| `google_flights_autocomplete` | Location autocomplete | 200/min |

### OpenAI

| Model | Purpose | Est. Cost |
|-------|---------|-----------|
| `gpt-4o` | Orchestrator, Cost Breakdown | $0.005/1K tokens |
| `gpt-4o-mini` | Flight/Hotel Agents | $0.00015/1K tokens |
