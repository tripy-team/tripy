# Tripy Implementation Plan v5.0
## Complete Technical Specification

### Document Information

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| v1.0 | Jan 2026 | - | Initial implementation plan |
| v2.0 | Jan 2026 | - | Multi-modal transport, autocomplete, chatbot |
| v3.0 | Jan 2026 | - | Detailed algorithm, minimize out-of-pocket objective |
| v4.0 | Jan 2026 | - | No hardcoded data, dynamic card benefits |
| v5.0 | Jan 2026 | - | **Complete technical specification with APIs, logic, optimizations** |

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Core Algorithm: ILP Optimization](#2-core-algorithm-ilp-optimization)
3. [Flight Search Implementation](#3-flight-search-implementation)
4. [Train Search Implementation](#4-train-search-implementation)
5. [Bus Search Implementation](#5-bus-search-implementation)
6. [Credit Card Benefits System](#6-credit-card-benefits-system)
7. [Transfer Partner System](#7-transfer-partner-system)
8. [Location Resolution System](#8-location-resolution-system)
9. [Database Schema](#9-database-schema)
10. [API Layer Implementation](#10-api-layer-implementation)
11. [Performance Optimizations](#11-performance-optimizations)
12. [Error Handling & Fallbacks](#12-error-handling--fallbacks)
13. [Testing Strategy](#13-testing-strategy)
14. [Deployment Configuration](#14-deployment-configuration)

---

## 1. System Architecture

### 1.1 High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    CLIENT LAYER                                          │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         Next.js 15 Frontend (React 19)                           │   │
│  │  • Trip Setup Forms    • Autocomplete Components    • Results Display            │   │
│  │  • Points Management   • Card Management            • Booking Flow               │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          │ HTTPS/REST
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    API GATEWAY                                           │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                         AWS App Runner / API Gateway                              │   │
│  │  • Rate Limiting       • Request Validation         • CORS Handling              │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                   SERVICE LAYER                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │ Itinerary Service│  │ Transport Service│  │   Card Service   │  │ Points Service│   │
│  │                  │  │                  │  │                  │  │              │   │
│  │ • Optimization   │  │ • Flight Search  │  │ • Benefits Calc  │  │ • Balance Mgmt│   │
│  │ • Path Finding   │  │ • Train Search   │  │ • Card Matching  │  │ • Transfers   │   │
│  │ • Result Build   │  │ • Bus Search     │  │ • Value Estimate │  │ • Valuations  │   │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘  └──────┬───────┘   │
│           │                     │                     │                   │            │
│           └─────────────────────┴─────────────────────┴───────────────────┘            │
│                                          │                                              │
│                                          ▼                                              │
│  ┌─────────────────────────────────────────────────────────────────────────────────┐   │
│  │                              ILP OPTIMIZER (PuLP/CBC)                             │   │
│  │                                                                                   │   │
│  │  MINIMIZE: W₁×(CashCost + Surcharges - CardBenefits) + W₂×Time                   │   │
│  │                                                                                   │   │
│  │  Subject to: Path Constraints, Budget Constraints, Points Availability           │   │
│  └─────────────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                    DATA LAYER                                            │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │    DynamoDB      │  │   Redis Cache    │  │    S3/CDN        │  │  AWS Cognito │   │
│  │                  │  │                  │  │                  │  │              │   │
│  │ • Users          │  │ • API Responses  │  │ • City Images    │  │ • Auth       │   │
│  │ • Trips          │  │ • Station Cache  │  │ • Static Assets  │  │ • JWT        │   │
│  │ • Cards          │  │ • Price Cache    │  │                  │  │              │   │
│  │ • Benefits       │  │                  │  │                  │  │              │   │
│  │ • Partners       │  │                  │  │                  │  │              │   │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘  └──────────────┘   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                               EXTERNAL SERVICES                                          │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │ AwardTool │  │  Amadeus  │  │  SerpAPI  │  │ Trainline │  │  OpenAI   │            │
│  │           │  │           │  │           │  │           │  │           │            │
│  │ Award     │  │ Flights   │  │ Google    │  │ EU Trains │  │ NLP       │            │
│  │ Flights   │  │ Cities    │  │ Flights   │  │           │  │ Fallbacks │            │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘            │
│                                                                                         │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐  ┌───────────┐            │
│  │  FlixBus  │  │  Amtrak   │  │    JR     │  │  BusBud   │  │ Rome2Rio  │            │
│  │           │  │           │  │           │  │           │  │           │            │
│  │ EU/US Bus │  │ US Train  │  │ JP Train  │  │ Bus Agg.  │  │ Multi-    │            │
│  │           │  │           │  │           │  │           │  │ Modal     │            │
│  └───────────┘  └───────────┘  └───────────┘  └───────────┘  └───────────┘            │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Technology Stack

| Layer | Technology | Purpose | Version |
|-------|------------|---------|---------|
| Frontend | Next.js | React framework | 15.x |
| Frontend | React | UI library | 19.x |
| Frontend | TypeScript | Type safety | 5.x |
| Frontend | Tailwind CSS | Styling | 4.x |
| Backend | FastAPI | Web framework | 0.100+ |
| Backend | Python | Language | 3.11+ |
| Backend | PuLP | ILP solver | 2.7+ |
| Backend | Pydantic | Validation | 2.x |
| Database | DynamoDB | NoSQL storage | - |
| Cache | Redis | Response caching | 7.x |
| Auth | AWS Cognito | User auth | - |
| CDN | CloudFront | Asset delivery | - |

### 1.3 File Structure

```
backend/
├── src/
│   ├── app.py                          # FastAPI application
│   ├── config.py                       # Configuration
│   ├── models.py                       # Pydantic models
│   │
│   ├── handlers/                       # Request handlers
│   │   ├── ilp_adapter.py              # ILP input builder
│   │   ├── points_maximizer.py         # ILP solver (v3 objective)
│   │   ├── points_minimizer.py         # NEW: v5 objective (minimize out-of-pocket)
│   │   ├── flights.py                  # Flight search orchestration
│   │   ├── ground_transport.py         # Ground transport handler
│   │   └── ...
│   │
│   ├── services/                       # Business logic
│   │   ├── itinerary_service.py        # Itinerary generation
│   │   ├── transport/                  # NEW: Transport services
│   │   │   ├── __init__.py
│   │   │   ├── flight_service.py       # Multi-provider flight search
│   │   │   ├── train_service.py        # Multi-provider train search
│   │   │   ├── bus_service.py          # Multi-provider bus search
│   │   │   ├── station_service.py      # Station resolution
│   │   │   └── unified_edge_builder.py # Edge normalization
│   │   │
│   │   ├── card_service.py             # NEW: Card benefits service
│   │   ├── transfer_service.py         # NEW: Transfer partners service
│   │   └── ...
│   │
│   ├── repos/                          # Data access
│   │   ├── card_repo.py                # NEW: Card CRUD
│   │   ├── benefit_repo.py             # NEW: Benefits CRUD
│   │   ├── transfer_partner_repo.py    # NEW: Transfer partners CRUD
│   │   ├── station_cache_repo.py       # NEW: Station cache
│   │   └── ...
│   │
│   └── utils/                          # Utilities
│       ├── cache_layer.py              # Redis caching
│       ├── api_clients/                # NEW: External API clients
│       │   ├── awardtool_client.py
│       │   ├── amadeus_client.py
│       │   ├── trainline_client.py
│       │   ├── flixbus_client.py
│       │   └── ...
│       └── ...
│
└── tests/
    ├── test_ilp_optimizer.py
    ├── test_transport_services.py
    ├── test_card_benefits.py
    └── ...
```

---

## 2. Core Algorithm: ILP Optimization

### 2.1 Problem Definition

**Given:**
- A set of travelers T = {t₁, t₂, ..., tₙ}
- Cities to visit C = {c₁, c₂, ..., cₘ} with start/end cities per traveler
- Transport edges E with costs and times
- Points balances per traveler per program
- Credit cards per traveler with benefits
- Budget constraints

**Find:**
- Optimal path through all required cities
- Optimal payment method for each edge (cash vs points)
- Optimal card to use for each edge (to maximize benefits)

**Objective:**
```
MINIMIZE: W₁ × (OutOfPocket - CardBenefits) + W₂ × Time

Where:
- OutOfPocket = Σ(cash_bookings) + Σ(points_surcharges)
- CardBenefits = Σ(benefit_value for each edge where card is used)
- W₁ = 1,000,000 (primary: minimize net cost)
- W₂ = 1 (secondary: minimize time)
```

### 2.2 Mathematical Formulation

#### Decision Variables

```
x[p][e] ∈ {0,1}           : Passenger p takes edge e
z[q,p][e] ∈ {0,1}         : Payer q pays CASH for passenger p on edge e
y[q,p][s,a][e] ∈ {0,1}    : Payer q transfers from bank s to airline a for passenger p on edge e
y_native[q,p][a][e] ∈ {0,1}: Payer q uses native miles from airline a for passenger p on edge e
t_blocks[q][s,a] ∈ Z⁺     : Transfer blocks (1000 points each) from bank s to airline a for payer q
card[q][c][e] ∈ {0,1}     : Payer q uses card c for edge e
```

#### Constraints

**1. Path Constraints (Flow Conservation)**
```
For each passenger p:
  - Leave start city exactly once: Σ{e: e.origin = start[p]} x[p][e] = 1
  - Enter end city exactly once:   Σ{e: e.dest = end[p]} x[p][e] = 1
  - Flow conservation at intermediate cities:
    For each city c ∉ {start[p], end[p]}:
      Σ{e: e.origin = c} x[p][e] = Σ{e: e.dest = c} x[p][e]
```

**2. Must-Visit Constraints**
```
For each must-visit city c:
  For each passenger p:
    Σ{e: e.dest = c} x[p][e] = 1  (enter exactly once)
```

**3. Payment Exclusivity**
```
For each passenger p, edge e:
  Σ{q} z[q,p][e] + Σ{q,s,a} y[q,p][s,a][e] + Σ{q,a} y_native[q,p][a][e] = x[p][e]
```

**4. Points Transfer Constraints**
```
For each payer q, bank s, airline a:
  Miles used ≤ Miles transferred:
    Σ{p,e} y[q,p][s,a][e] × miles[a][e] ≤ t_blocks[q][s,a] × block_size × ratio[s,a] × bonus[s,a]
  
  Points transferred ≤ Balance:
    t_blocks[q][s,a] × block_size ≤ balance[q][s]
```

**5. Native Miles Constraints**
```
For each payer q, airline a:
  Σ{p,e} y_native[q,p][a][e] × miles[a][e] ≤ native_balance[q][a]
```

**6. Budget Constraints**
```
For each payer q:
  Σ{p,e} z[q,p][e] × cash_cost[e] + 
  Σ{p,s,a,e} y[q,p][s,a][e] × surcharge[a][e] +
  Σ{p,a,e} y_native[q,p][a][e] × surcharge[a][e] ≤ budget[q]
```

**7. Card Usage Constraints**
```
For each payer q, edge e:
  Σ{c} card[q][c][e] ≤ 1  (at most one card per edge)

For each payer q, card c, edge e:
  card[q][c][e] ≤ is_paying[q][e]  (can only use card if paying)
```

### 2.3 Implementation

```python
# backend/src/handlers/points_minimizer.py

"""
ILP Optimizer v5: Minimize Out-of-Pocket with Card Benefits

This is the core optimization algorithm for Tripy.
"""

from typing import List, Dict, Tuple, Set, Optional, Any
import pulp as pl
from dataclasses import dataclass
import logging

logger = logging.getLogger(__name__)


@dataclass
class EdgeBenefit:
    """Represents a card benefit applicable to an edge."""
    card_id: str
    benefit_type: str
    monetary_value: float
    description: str


@dataclass
class OptimizationResult:
    """Result of the ILP optimization."""
    status: str
    path: Dict[str, List[str]]
    edges: Dict[str, List[List[str]]]
    pay_mode: Dict[str, List[Dict[str, Any]]]
    card_usage: Dict[str, Dict[str, int]]
    totals: Dict[str, Any]


class OutOfPocketMinimizer:
    """
    ILP-based optimizer that minimizes out-of-pocket expenses.
    
    Key features:
    1. Considers all transport modes (flights, trains, buses)
    2. Optimally allocates points vs cash payments
    3. Selects cards to maximize benefit value
    4. Handles multiple travelers with different balances
    
    Complexity Analysis:
    - Variables: O(|T|² × |E| × (|S| × |A| + |A| + |C|))
    - Constraints: O(|T|² × |E| × |A| + |T| × |C|)
    - Where T=travelers, E=edges, S=banks, A=airlines, C=cards
    
    For typical inputs (2 travelers, 50 edges, 5 banks, 10 airlines, 5 cards):
    - ~10,000 variables
    - ~5,000 constraints
    - Solve time: 1-5 seconds with CBC solver
    """
    
    def __init__(
        self,
        W1: float = 1e6,  # Weight for out-of-pocket
        W2: float = 1.0,  # Weight for time
        solver_timeout: int = 30,
    ):
        self.W1 = W1
        self.W2 = W2
        self.solver_timeout = solver_timeout
        self.INF = 1e9
    
    def optimize(
        self,
        # Travelers and routing
        travelers: List[str],
        start_city: Dict[str, str],
        end_city: Dict[str, str],
        cities: List[str],
        edges: List[Tuple[str, str, str]],
        must_visit_cities: List[str],
        # Costs
        time_cost: Dict[Tuple, float],
        cash_cost: Dict[Tuple, float],
        # Airlines and points
        airlines: List[str],
        award_points: Dict[str, Dict[Tuple, float]],
        cash_surcharge: Dict[str, Dict[Tuple, float]],
        allowed_award_edge: Dict[str, Dict[Tuple, int]],
        # User balances
        sources_by_trav: Dict[str, List[str]],
        source_balances: Dict[Tuple[str, str], float],
        miles_balance: Dict[Tuple[str, str], float],
        # Transfer rules
        allowed_sa: Set[Tuple[str, str]],
        ratio: Dict[Tuple[str, str], float],
        bonus: Dict[Tuple[str, str], float],
        inc_source: Dict[Tuple[str, str], int],
        # Payment rules
        link_ok: Dict[Tuple[str, str], int],
        budget_cash: Dict[str, float],
        can_pay_for: Dict[Tuple[str, str], int],
        # Card benefits
        user_cards: Dict[str, List[str]],  # {traveler: [card_ids]}
        edge_benefits: Dict[Tuple, Dict[str, List[EdgeBenefit]]],  # {edge: {card_id: [benefits]}}
    ) -> OptimizationResult:
        """
        Run the ILP optimization.
        
        Args:
            travelers: List of traveler IDs
            start_city: {traveler: start_city_code}
            end_city: {traveler: end_city_code}
            cities: All city codes in the graph
            edges: List of (origin, dest, mode_id) tuples
            must_visit_cities: Cities that must be visited
            time_cost: {edge: minutes}
            cash_cost: {edge: USD}
            airlines: List of airline codes that can price edges
            award_points: {airline: {edge: miles_required}}
            cash_surcharge: {airline: {edge: taxes_fees}}
            allowed_award_edge: {airline: {edge: 0/1}}
            sources_by_trav: {traveler: [bank_codes]}
            source_balances: {(traveler, bank): balance}
            miles_balance: {(traveler, airline): balance}
            allowed_sa: Set of (bank, airline) transfer pairs
            ratio: {(bank, airline): transfer_ratio}
            bonus: {(bank, airline): bonus_multiplier}
            inc_source: {(bank, airline): block_size}
            link_ok: {(traveler, airline): 0/1}
            budget_cash: {traveler: max_cash}
            can_pay_for: {(payer, passenger): 0/1}
            user_cards: {traveler: [card_ids]}
            edge_benefits: {edge: {card_id: [EdgeBenefit]}}
        
        Returns:
            OptimizationResult with optimal path and payment allocation
        """
        T = travelers
        A = airlines
        
        # ═══════════════════════════════════════════════════════════════════
        # HELPER FUNCTIONS
        # ═══════════════════════════════════════════════════════════════════
        
        def get_miles(airline: str, edge: Tuple) -> float:
            """Get miles required for edge on airline."""
            return award_points.get(airline, {}).get(edge, self.INF)
        
        def get_surcharge(airline: str, edge: Tuple) -> float:
            """Get surcharge for edge on airline."""
            val = cash_surcharge.get(airline, {}).get(edge, self.INF)
            return val if val < self.INF else 0.0
        
        def can_price(airline: str, edge: Tuple) -> bool:
            """Can airline price this edge with points?"""
            return allowed_award_edge.get(airline, {}).get(edge, 0) == 1
        
        def get_benefit_value(edge: Tuple, card_id: str) -> float:
            """Get total benefit value for edge+card combo."""
            benefits = edge_benefits.get(edge, {}).get(card_id, [])
            return sum(b.monetary_value for b in benefits)
        
        def get_traveler_cards(traveler: str) -> List[str]:
            """Get card IDs for traveler."""
            return user_cards.get(traveler, [])
        
        # ═══════════════════════════════════════════════════════════════════
        # CREATE MODEL
        # ═══════════════════════════════════════════════════════════════════
        
        logger.info(f"Creating ILP model: {len(T)} travelers, {len(edges)} edges, {len(A)} airlines")
        
        m = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
        
        # ─────────────────────────────────────────────────────────────────
        # DECISION VARIABLES
        # ─────────────────────────────────────────────────────────────────
        
        # x[p][e]: Does passenger p take edge e?
        x = {
            p: {e: pl.LpVariable(f"x_{p}_{self._edge_id(e)}", cat="Binary") for e in edges}
            for p in T
        }
        
        # z[q,p][e]: Does payer q pay CASH for passenger p on edge e?
        z = {
            (q, p): {e: pl.LpVariable(f"z_{q}_{p}_{self._edge_id(e)}", cat="Binary") for e in edges}
            for q in T for p in T
        }
        
        # y[q,p][s,a][e]: Transfer from bank s to airline a
        y = {}
        for q in T:
            for p in T:
                y[(q, p)] = {}
                for s in sources_by_trav.get(q, []):
                    for a in A:
                        if (s, a) in allowed_sa:
                            y[(q, p)][(s, a)] = {
                                e: pl.LpVariable(f"y_{q}_{p}_{s}_{a}_{self._edge_id(e)}", cat="Binary")
                                for e in edges
                            }
        
        # y_native[q,p][a][e]: Use native miles from airline a
        y_native = {
            (q, p): {
                a: {e: pl.LpVariable(f"yn_{q}_{p}_{a}_{self._edge_id(e)}", cat="Binary") for e in edges}
                for a in A
            }
            for q in T for p in T
        }
        
        # t_blocks[q][s,a]: Transfer blocks
        t_blocks = {}
        for q in T:
            t_blocks[q] = {}
            for s in sources_by_trav.get(q, []):
                for a in A:
                    if (s, a) in allowed_sa:
                        t_blocks[q][(s, a)] = pl.LpVariable(f"t_{q}_{s}_{a}", lowBound=0, cat="Integer")
        
        # card[q][c][e]: Does payer q use card c for edge e?
        card_use = {}
        for q in T:
            card_use[q] = {}
            for c in get_traveler_cards(q):
                card_use[q][c] = {
                    e: pl.LpVariable(f"card_{q}_{c}_{self._edge_id(e)}", cat="Binary")
                    for e in edges
                }
        
        # ═══════════════════════════════════════════════════════════════════
        # CONSTRAINTS
        # ═══════════════════════════════════════════════════════════════════
        
        # ─────────────────────────────────────────────────────────────────
        # C1: Path Constraints (Flow Conservation)
        # ─────────────────────────────────────────────────────────────────
        
        for p in T:
            # Leave start exactly once
            m += pl.lpSum(x[p][e] for e in edges if e[0] == start_city[p]) == 1, f"start_{p}"
            
            # Enter end exactly once
            m += pl.lpSum(x[p][e] for e in edges if e[1] == end_city[p]) == 1, f"end_{p}"
            
            # Flow conservation
            for city in cities:
                outflow = pl.lpSum(x[p][e] for e in edges if e[0] == city)
                inflow = pl.lpSum(x[p][e] for e in edges if e[1] == city)
                
                if city == start_city[p]:
                    m += outflow - inflow == 1, f"flow_{p}_{city}_start"
                elif city == end_city[p]:
                    m += outflow - inflow == -1, f"flow_{p}_{city}_end"
                else:
                    m += outflow == inflow, f"flow_{p}_{city}"
        
        # ─────────────────────────────────────────────────────────────────
        # C2: Must-Visit Constraints
        # ─────────────────────────────────────────────────────────────────
        
        for city in (must_visit_cities or []):
            for p in T:
                if city != start_city.get(p) and city != end_city.get(p):
                    m += pl.lpSum(x[p][e] for e in edges if e[1] == city) == 1, f"visit_{p}_{city}"
        
        # ─────────────────────────────────────────────────────────────────
        # C3: Payment Exclusivity
        # ─────────────────────────────────────────────────────────────────
        
        for p in T:
            for e in edges:
                cash_pay = pl.lpSum(z[(q, p)][e] for q in T)
                transfer_pay = pl.lpSum(
                    y[(q, p)][(s, a)][e]
                    for q in T
                    for (s, a) in y[(q, p)].keys()
                )
                native_pay = pl.lpSum(y_native[(q, p)][a][e] for q in T for a in A)
                
                m += cash_pay + transfer_pay + native_pay == x[p][e], f"pay_excl_{p}_{self._edge_id(e)}"
        
        # ─────────────────────────────────────────────────────────────────
        # C4: can_pay_for Restrictions
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            for p in T:
                if can_pay_for.get((q, p), 0) == 0:
                    for e in edges:
                        m += z[(q, p)][e] == 0, f"nopay_cash_{q}_{p}_{self._edge_id(e)}"
                        for (s, a) in y[(q, p)].keys():
                            m += y[(q, p)][(s, a)][e] == 0
                        for a in A:
                            m += y_native[(q, p)][a][e] == 0
        
        # ─────────────────────────────────────────────────────────────────
        # C5: Transfer Balance Constraints
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            for s in sources_by_trav.get(q, []):
                for a in A:
                    if (s, a) not in allowed_sa:
                        continue
                    
                    block_size = inc_source.get((s, a), 1000)
                    transfer_ratio = ratio.get((s, a), 1.0)
                    bonus_mult = bonus.get((s, a), 1.0)
                    miles_per_block = block_size * transfer_ratio * bonus_mult
                    
                    # Miles used via transfer
                    miles_used = pl.lpSum(
                        y[(q, p)][(s, a)][e] * get_miles(a, e)
                        for p in T
                        for e in edges
                        if (s, a) in y[(q, p)]
                    )
                    
                    m += miles_used <= t_blocks[q][(s, a)] * miles_per_block, f"transfer_cap_{q}_{s}_{a}"
                    m += t_blocks[q][(s, a)] * block_size <= source_balances.get((q, s), 0), f"balance_cap_{q}_{s}_{a}"
        
        # ─────────────────────────────────────────────────────────────────
        # C6: Native Miles Constraints
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            for a in A:
                miles_used = pl.lpSum(
                    y_native[(q, p)][a][e] * get_miles(a, e)
                    for p in T
                    for e in edges
                )
                m += miles_used <= miles_balance.get((q, a), 0), f"native_cap_{q}_{a}"
        
        # ─────────────────────────────────────────────────────────────────
        # C7: Eligibility (link_ok and can_price)
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            for p in T:
                for e in edges:
                    for (s, a) in y[(q, p)].keys():
                        can_use = link_ok.get((q, a), 0) * (1 if can_price(a, e) else 0)
                        if can_use == 0:
                            m += y[(q, p)][(s, a)][e] == 0
                    
                    for a in A:
                        can_use = link_ok.get((q, a), 0) * (1 if can_price(a, e) else 0)
                        if can_use == 0:
                            m += y_native[(q, p)][a][e] == 0
        
        # ─────────────────────────────────────────────────────────────────
        # C8: Budget Constraints
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            cash_spend = pl.lpSum(z[(q, p)][e] * cash_cost.get(e, 0) for p in T for e in edges)
            
            transfer_sur = pl.lpSum(
                y[(q, p)][(s, a)][e] * get_surcharge(a, e)
                for p in T
                for (s, a) in y[(q, p)].keys()
                for e in edges
            )
            
            native_sur = pl.lpSum(
                y_native[(q, p)][a][e] * get_surcharge(a, e)
                for p in T
                for a in A
                for e in edges
            )
            
            m += cash_spend + transfer_sur + native_sur <= budget_cash[q], f"budget_{q}"
        
        # ─────────────────────────────────────────────────────────────────
        # C9: Card Usage Constraints
        # ─────────────────────────────────────────────────────────────────
        
        for q in T:
            for e in edges:
                # At most one card per edge
                if card_use[q]:
                    m += pl.lpSum(card_use[q][c][e] for c in card_use[q].keys()) <= 1, f"one_card_{q}_{self._edge_id(e)}"
        
        # Card can only be used if payer is paying
        for q in T:
            for p in T:
                for e in edges:
                    is_paying = (
                        z[(q, p)][e]
                        + pl.lpSum(y[(q, p)][(s, a)][e] for (s, a) in y[(q, p)].keys())
                        + pl.lpSum(y_native[(q, p)][a][e] for a in A)
                    )
                    for c in get_traveler_cards(q):
                        m += card_use[q][c][e] <= is_paying
        
        # ═══════════════════════════════════════════════════════════════════
        # OBJECTIVE FUNCTION
        # ═══════════════════════════════════════════════════════════════════
        
        # Cash bookings
        cash_total = pl.lpSum(
            z[(q, p)][e] * cash_cost.get(e, 0)
            for q in T for p in T for e in edges
        )
        
        # Surcharges on points bookings
        surcharge_total = (
            pl.lpSum(
                y[(q, p)][(s, a)][e] * get_surcharge(a, e)
                for q in T for p in T
                for (s, a) in y[(q, p)].keys()
                for e in edges
            )
            + pl.lpSum(
                y_native[(q, p)][a][e] * get_surcharge(a, e)
                for q in T for p in T for a in A for e in edges
            )
        )
        
        out_of_pocket = cash_total + surcharge_total
        
        # Card benefits
        benefits_total = pl.lpSum(
            card_use[q][c][e] * get_benefit_value(e, c)
            for q in T
            for c in get_traveler_cards(q)
            for e in edges
        )
        
        # Time
        time_total = pl.lpSum(
            x[p][e] * time_cost.get(e, 0)
            for p in T for e in edges
        )
        
        # OBJECTIVE: Minimize (cost - benefits) + time
        m += self.W1 * (out_of_pocket - benefits_total) + self.W2 * time_total
        
        # ═══════════════════════════════════════════════════════════════════
        # SOLVE
        # ═══════════════════════════════════════════════════════════════════
        
        logger.info("Solving ILP...")
        solver = pl.PULP_CBC_CMD(msg=False, timeLimit=self.solver_timeout)
        m.solve(solver)
        
        status = pl.LpStatus[m.status]
        logger.info(f"ILP solution status: {status}")
        
        # ═══════════════════════════════════════════════════════════════════
        # EXTRACT SOLUTION
        # ═══════════════════════════════════════════════════════════════════
        
        return self._extract_solution(
            status, T, A, edges, start_city, end_city,
            x, z, y, y_native, t_blocks, card_use,
            time_cost, cash_cost, get_miles, get_surcharge,
            edge_benefits, user_cards, inc_source, ratio, bonus
        )
    
    def _edge_id(self, edge: Tuple) -> str:
        """Create a safe string ID from edge tuple."""
        return f"{edge[0]}_{edge[1]}_{edge[2]}"
    
    def _extract_solution(
        self,
        status: str,
        T: List[str],
        A: List[str],
        edges: List[Tuple],
        start_city: Dict[str, str],
        end_city: Dict[str, str],
        x, z, y, y_native, t_blocks, card_use,
        time_cost, cash_cost, get_miles, get_surcharge,
        edge_benefits, user_cards, inc_source, ratio, bonus
    ) -> OptimizationResult:
        """Extract solution from solved ILP model."""
        
        result = OptimizationResult(
            status=status,
            path={p: [] for p in T},
            edges={p: [] for p in T},
            pay_mode={p: [] for p in T},
            card_usage={q: {} for q in T},
            totals={
                "cash": 0.0,
                "airline_points": 0.0,
                "time": 0.0,
                "benefits_value": 0.0,
                "effective_cost": 0.0,
                "transfers": {},
                "native_used": {},
            }
        )
        
        if status != "Optimal":
            return result
        
        # Extract paths
        for p in T:
            chosen = [e for e in edges if pl.value(x[p][e]) > 0.5]
            result.edges[p] = [[e[0], e[1], e[2]] for e in chosen]
            
            # Reconstruct path
            next_city = {e[0]: e[1] for e in chosen}
            path = [start_city[p]]
            cur = start_city[p]
            while cur in next_city and cur != end_city[p]:
                cur = next_city[cur]
                path.append(cur)
            result.path[p] = path
        
        # Extract payments
        total_cash = 0.0
        total_points = 0.0
        total_time = 0.0
        total_benefits = 0.0
        
        for p in T:
            for e in [tuple(edge) for edge in result.edges[p]]:
                total_time += time_cost.get(e, 0)
                
                payment = {"edge": [e[0], e[1], e[2]], "mode": self._get_mode(e)}
                
                # Find payment method
                for q in T:
                    if pl.value(z[(q, p)][e]) > 0.5:
                        fare = cash_cost.get(e, 0)
                        total_cash += fare
                        payment.update({"type": "cash", "payer": q, "fare": fare})
                        break
                    
                    for (s, a) in y[(q, p)].keys():
                        if pl.value(y[(q, p)][(s, a)][e]) > 0.5:
                            miles = get_miles(a, e)
                            sur = get_surcharge(a, e)
                            total_cash += sur
                            total_points += miles
                            payment.update({
                                "type": "points",
                                "payer": q,
                                "via": {"source": s, "airline": a},
                                "miles": miles,
                                "surcharge": sur,
                            })
                            break
                    
                    for a in A:
                        if pl.value(y_native[(q, p)][a][e]) > 0.5:
                            miles = get_miles(a, e)
                            sur = get_surcharge(a, e)
                            total_cash += sur
                            total_points += miles
                            payment.update({
                                "type": "points",
                                "payer": q,
                                "via": {"native": a},
                                "miles": miles,
                                "surcharge": sur,
                            })
                            break
                
                # Find card usage
                for q in T:
                    for c in user_cards.get(q, []):
                        if q in card_use and c in card_use[q]:
                            if pl.value(card_use[q][c][e]) > 0.5:
                                benefit_val = sum(
                                    b.monetary_value
                                    for b in edge_benefits.get(e, {}).get(c, [])
                                )
                                total_benefits += benefit_val
                                payment["card_used"] = c
                                payment["benefits_value"] = benefit_val
                                payment["benefits"] = [
                                    {"type": b.benefit_type, "value": b.monetary_value, "desc": b.description}
                                    for b in edge_benefits.get(e, {}).get(c, [])
                                ]
                                result.card_usage[q][c] = result.card_usage[q].get(c, 0) + 1
                                break
                
                result.pay_mode[p].append(payment)
        
        result.totals["cash"] = total_cash
        result.totals["airline_points"] = total_points
        result.totals["time"] = total_time
        result.totals["benefits_value"] = total_benefits
        result.totals["effective_cost"] = total_cash - total_benefits
        
        return result
    
    def _get_mode(self, edge: Tuple) -> str:
        """Extract transport mode from edge ID."""
        mode_id = str(edge[2]).upper()
        if "TRAIN" in mode_id:
            return "train"
        if "BUS" in mode_id:
            return "bus"
        return "flight"
```

### 2.4 Optimization Strategies

#### Strategy 1: Edge Pruning (Pre-processing)

```python
def prune_dominated_edges(edges_dict: Dict) -> Dict:
    """
    Remove edges that are strictly dominated by others.
    
    An edge e1 is dominated by e2 if:
    - Same origin and destination
    - e2.cash_cost ≤ e1.cash_cost
    - e2.time_cost ≤ e1.time_cost
    - e2 has same or better points options
    
    This can reduce edge count by 30-50%.
    """
    by_od = defaultdict(list)
    for e, data in edges_dict.items():
        od = (e[0], e[1])
        by_od[od].append((e, data))
    
    pruned = {}
    for od, candidates in by_od.items():
        # Keep Pareto-optimal edges
        for e1, d1 in candidates:
            dominated = False
            for e2, d2 in candidates:
                if e1 == e2:
                    continue
                if (d2["cash_cost"] <= d1["cash_cost"] and
                    d2["time_cost"] <= d1["time_cost"] and
                    d2.get("points_surcharge", float('inf')) <= d1.get("points_surcharge", float('inf'))):
                    dominated = True
                    break
            if not dominated:
                pruned[e1] = d1
    
    return pruned
```

#### Strategy 2: Warm Starting

```python
def build_initial_solution(edges_dict, travelers, start_city, end_city):
    """
    Build a feasible initial solution using greedy heuristic.
    
    This gives CBC a starting point, often reducing solve time by 50%.
    """
    solution = {}
    
    for t in travelers:
        # Greedy: choose cheapest out-of-pocket path
        path = dijkstra_min_cost(edges_dict, start_city[t], end_city[t])
        for e in path:
            solution[f"x_{t}_{e[0]}_{e[1]}_{e[2]}"] = 1
    
    return solution
```

#### Strategy 3: Constraint Relaxation for Infeasibility

```python
def solve_with_relaxation(optimizer, inputs, max_relaxations=3):
    """
    If ILP is infeasible, progressively relax constraints.
    
    Relaxation order:
    1. Increase budget by 20%
    2. Remove must-visit cities one by one
    3. Allow any payment method (remove link_ok restrictions)
    """
    result = optimizer.optimize(**inputs)
    
    if result.status == "Optimal":
        return result
    
    relaxation_level = 0
    while result.status != "Optimal" and relaxation_level < max_relaxations:
        relaxation_level += 1
        
        if relaxation_level == 1:
            # Relax budget
            for q in inputs["budget_cash"]:
                inputs["budget_cash"][q] *= 1.2
        
        elif relaxation_level == 2:
            # Remove one must-visit city
            if inputs["must_visit_cities"]:
                inputs["must_visit_cities"] = inputs["must_visit_cities"][:-1]
        
        elif relaxation_level == 3:
            # Allow all airlines
            for key in inputs["link_ok"]:
                inputs["link_ok"][key] = 1
        
        result = optimizer.optimize(**inputs)
    
    return result
```

---

## 3. Flight Search Implementation

### 3.1 API Selection

| API | Purpose | Cost | Rate Limits | Pros | Cons |
|-----|---------|------|-------------|------|------|
| **AwardTool** | Award availability | $0.10/search | 100/min | Best award data | Expensive |
| **Amadeus** | Cash prices, schedules | $0.005/call | 1000/min | Accurate, cheap | No award data |
| **SerpAPI** | Google Flights | $0.025/search | 500/min | Real prices | Rate limits |
| **Skyscanner** | Price comparison | Free tier | 50/min | Free | Limited data |

### 3.2 Implementation

```python
# backend/src/services/transport/flight_service.py

"""
Flight Service: Multi-provider flight search.

Search Strategy:
1. Query AwardTool for award availability (primary)
2. Query Amadeus for cash prices and schedules
3. Query SerpAPI as fallback for cash prices
4. Merge and deduplicate results

Caching:
- Cache award availability for 15 minutes
- Cache cash prices for 30 minutes
"""

import asyncio
import httpx
from typing import Dict, List, Optional, Tuple, Any
from datetime import datetime, timedelta
from dataclasses import dataclass
import logging

from src.utils.cache_layer import CacheLayer
from src.utils.api_clients.awardtool_client import AwardToolClient
from src.utils.api_clients.amadeus_client import AmadeusClient
from src.utils.api_clients.serpapi_client import SerpAPIClient

logger = logging.getLogger(__name__)


@dataclass
class FlightOption:
    """Normalized flight option from any provider."""
    flight_number: str
    airline: str
    origin: str
    destination: str
    departure: datetime
    arrival: datetime
    duration_minutes: int
    cash_price: Optional[float]
    # Award options (if available)
    award_programs: List[Dict[str, Any]]  # [{program, miles, surcharge, cabin}]
    source: str  # Which API provided this


class FlightService:
    """
    Unified flight search across multiple providers.
    
    Usage:
        service = FlightService()
        flights = await service.search(
            origin="SEA",
            destination="NRT",
            date="2025-03-15",
            passengers=2,
            include_award=True,
        )
    """
    
    def __init__(self):
        self.cache = CacheLayer()
        self.awardtool = AwardToolClient()
        self.amadeus = AmadeusClient()
        self.serpapi = SerpAPIClient()
    
    async def search(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
        include_award: bool = True,
        cabin: str = "economy",
    ) -> List[FlightOption]:
        """
        Search for flights across all providers.
        
        Args:
            origin: Origin airport code (e.g., "SEA")
            destination: Destination airport code (e.g., "NRT")
            date: Travel date (YYYY-MM-DD)
            passengers: Number of passengers
            include_award: Whether to search for award availability
            cabin: Cabin class (economy, business, first)
        
        Returns:
            List of FlightOption objects, sorted by cash_price
        
        Algorithm:
        1. Generate cache key
        2. Check cache for recent results
        3. If cache miss, query all providers in parallel
        4. Merge results (combine award + cash data for same flight)
        5. Cache merged results
        6. Return sorted by out-of-pocket cost
        """
        cache_key = f"flights:{origin}:{destination}:{date}:{passengers}:{cabin}"
        
        # Check cache
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug(f"Cache hit for {cache_key}")
            return [FlightOption(**f) for f in cached]
        
        # Query providers in parallel
        tasks = []
        
        if include_award:
            tasks.append(self._search_awardtool(origin, destination, date, passengers, cabin))
        
        tasks.append(self._search_amadeus(origin, destination, date, passengers, cabin))
        tasks.append(self._search_serpapi(origin, destination, date, passengers))
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        # Process results
        all_flights: List[FlightOption] = []
        for i, result in enumerate(results):
            if isinstance(result, Exception):
                logger.warning(f"Flight search task {i} failed: {result}")
                continue
            if result:
                all_flights.extend(result)
        
        # Merge duplicates (same flight from different sources)
        merged = self._merge_flights(all_flights)
        
        # Sort by out-of-pocket (min of cash_price and min_surcharge)
        def out_of_pocket(f: FlightOption) -> float:
            cash = f.cash_price or float('inf')
            if f.award_programs:
                min_sur = min(p.get("surcharge", float('inf')) for p in f.award_programs)
                return min(cash, min_sur)
            return cash
        
        merged.sort(key=out_of_pocket)
        
        # Cache results (15 min for award, 30 min for cash-only)
        ttl = 900 if include_award else 1800
        await self.cache.set(cache_key, [self._to_dict(f) for f in merged], ttl=ttl)
        
        return merged
    
    async def _search_awardtool(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
        cabin: str,
    ) -> List[FlightOption]:
        """
        Search AwardTool for award flight availability.
        
        AwardTool API:
        - Endpoint: POST https://api.awardtool.com/v1/search
        - Auth: Bearer token
        - Request body: {origin, destination, date, passengers, cabin, programs}
        - Response: {flights: [{flight_number, airline, departure, arrival, 
                               duration_minutes, cash_price, award_options}]}
        
        Rate limit: 100 requests/minute
        Cost: ~$0.10 per search
        """
        try:
            response = await self.awardtool.search_flights(
                origin=origin,
                destination=destination,
                date=date,
                passengers=passengers,
                cabin=cabin,
            )
            
            flights = []
            for f in response.get("flights", []):
                flights.append(FlightOption(
                    flight_number=f.get("flight_number", ""),
                    airline=f.get("airline", ""),
                    origin=origin,
                    destination=destination,
                    departure=datetime.fromisoformat(f.get("departure", "")),
                    arrival=datetime.fromisoformat(f.get("arrival", "")),
                    duration_minutes=f.get("duration_minutes", 0),
                    cash_price=f.get("cash_price"),
                    award_programs=[
                        {
                            "program": ao.get("program"),
                            "miles": ao.get("miles_required"),
                            "surcharge": ao.get("taxes_fees"),
                            "cabin": ao.get("cabin"),
                            "availability": ao.get("seats_available"),
                        }
                        for ao in f.get("award_options", [])
                    ],
                    source="awardtool",
                ))
            
            logger.info(f"AwardTool returned {len(flights)} flights for {origin}->{destination}")
            return flights
            
        except Exception as e:
            logger.error(f"AwardTool search failed: {e}")
            return []
    
    async def _search_amadeus(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
        cabin: str,
    ) -> List[FlightOption]:
        """
        Search Amadeus for cash flight prices.
        
        Amadeus Flight Offers API:
        - Endpoint: GET /v2/shopping/flight-offers
        - Auth: OAuth2 bearer token (refresh every 30 min)
        - Params: originLocationCode, destinationLocationCode, departureDate,
                  adults, travelClass, currencyCode, max
        
        Rate limit: 1000 requests/minute (production)
        Cost: ~$0.005 per call
        """
        try:
            response = await self.amadeus.search_flights(
                origin=origin,
                destination=destination,
                date=date,
                passengers=passengers,
                cabin=cabin,
                max_results=20,
            )
            
            flights = []
            for offer in response.get("data", []):
                for itinerary in offer.get("itineraries", []):
                    # Handle direct flights and connections
                    segments = itinerary.get("segments", [])
                    if len(segments) == 1:
                        seg = segments[0]
                        flights.append(FlightOption(
                            flight_number=f"{seg['carrierCode']}{seg['number']}",
                            airline=seg.get("carrierCode", ""),
                            origin=seg.get("departure", {}).get("iataCode", ""),
                            destination=seg.get("arrival", {}).get("iataCode", ""),
                            departure=datetime.fromisoformat(seg.get("departure", {}).get("at", "")),
                            arrival=datetime.fromisoformat(seg.get("arrival", {}).get("at", "")),
                            duration_minutes=self._parse_duration(itinerary.get("duration", "")),
                            cash_price=float(offer.get("price", {}).get("total", 0)),
                            award_programs=[],  # Amadeus doesn't have award data
                            source="amadeus",
                        ))
            
            logger.info(f"Amadeus returned {len(flights)} flights for {origin}->{destination}")
            return flights
            
        except Exception as e:
            logger.error(f"Amadeus search failed: {e}")
            return []
    
    async def _search_serpapi(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[FlightOption]:
        """
        Search SerpAPI (Google Flights) for cash prices.
        
        SerpAPI Google Flights:
        - Endpoint: GET https://serpapi.com/search?engine=google_flights
        - Params: departure_id, arrival_id, outbound_date, adults, currency
        
        Rate limit: Depends on plan (100-5000/month)
        Cost: ~$0.025 per search
        
        Note: SerpAPI returns Google's cached prices which may be 
        slightly outdated but generally accurate.
        """
        try:
            response = await self.serpapi.search_flights(
                origin=origin,
                destination=destination,
                date=date,
                passengers=passengers,
            )
            
            flights = []
            
            # Best flights (non-stop or good connections)
            for f in response.get("best_flights", []):
                for leg in f.get("flights", []):
                    flights.append(FlightOption(
                        flight_number=leg.get("flight_number", ""),
                        airline=leg.get("airline", ""),
                        origin=leg.get("departure_airport", {}).get("id", ""),
                        destination=leg.get("arrival_airport", {}).get("id", ""),
                        departure=self._parse_serpapi_time(leg.get("departure_airport", {}).get("time", "")),
                        arrival=self._parse_serpapi_time(leg.get("arrival_airport", {}).get("time", "")),
                        duration_minutes=leg.get("duration", 0),
                        cash_price=f.get("price", 0),
                        award_programs=[],
                        source="serpapi",
                    ))
            
            # Other flights
            for f in response.get("other_flights", []):
                for leg in f.get("flights", []):
                    flights.append(FlightOption(
                        flight_number=leg.get("flight_number", ""),
                        airline=leg.get("airline", ""),
                        origin=leg.get("departure_airport", {}).get("id", ""),
                        destination=leg.get("arrival_airport", {}).get("id", ""),
                        departure=self._parse_serpapi_time(leg.get("departure_airport", {}).get("time", "")),
                        arrival=self._parse_serpapi_time(leg.get("arrival_airport", {}).get("time", "")),
                        duration_minutes=leg.get("duration", 0),
                        cash_price=f.get("price", 0),
                        award_programs=[],
                        source="serpapi",
                    ))
            
            logger.info(f"SerpAPI returned {len(flights)} flights for {origin}->{destination}")
            return flights
            
        except Exception as e:
            logger.error(f"SerpAPI search failed: {e}")
            return []
    
    def _merge_flights(self, flights: List[FlightOption]) -> List[FlightOption]:
        """
        Merge flights from different sources.
        
        Logic:
        - Group by (flight_number, departure_date)
        - Combine award_programs from all sources
        - Use best (lowest) cash_price
        """
        by_key: Dict[str, FlightOption] = {}
        
        for f in flights:
            key = f"{f.flight_number}:{f.departure.date()}"
            
            if key not in by_key:
                by_key[key] = f
            else:
                existing = by_key[key]
                
                # Merge award programs
                if f.award_programs:
                    existing.award_programs.extend(f.award_programs)
                
                # Use lower cash price
                if f.cash_price and (not existing.cash_price or f.cash_price < existing.cash_price):
                    existing.cash_price = f.cash_price
        
        return list(by_key.values())
    
    def _parse_duration(self, iso_duration: str) -> int:
        """Parse ISO 8601 duration (PT2H30M) to minutes."""
        import re
        match = re.match(r'PT(?:(\d+)H)?(?:(\d+)M)?', iso_duration or "")
        if not match:
            return 0
        hours = int(match.group(1) or 0)
        minutes = int(match.group(2) or 0)
        return hours * 60 + minutes
    
    def _parse_serpapi_time(self, time_str: str) -> datetime:
        """Parse SerpAPI time string."""
        try:
            return datetime.strptime(time_str, "%Y-%m-%d %H:%M")
        except:
            return datetime.now()
    
    def _to_dict(self, f: FlightOption) -> Dict:
        """Convert FlightOption to dict for caching."""
        return {
            "flight_number": f.flight_number,
            "airline": f.airline,
            "origin": f.origin,
            "destination": f.destination,
            "departure": f.departure.isoformat(),
            "arrival": f.arrival.isoformat(),
            "duration_minutes": f.duration_minutes,
            "cash_price": f.cash_price,
            "award_programs": f.award_programs,
            "source": f.source,
        }
```

### 3.3 Flight Edge Builder

```python
def flights_to_edges(
    flights: List[FlightOption],
    origin: str,
    destination: str,
) -> Dict[Tuple[str, str, str], Dict]:
    """
    Convert flight options to ILP edges.
    
    Each flight becomes an edge with:
    - Edge key: (origin, destination, flight_number)
    - cash_cost: Cash ticket price
    - time_cost: Flight duration in minutes
    - points_cost: Miles required (if award available)
    - points_program: Airline code
    - points_surcharge: Taxes/fees
    - mode: "flight"
    """
    edges = {}
    
    for flight in flights:
        edge_key = (origin, destination, flight.flight_number)
        
        edge_data = {
            "cash_cost": flight.cash_price or 1e7,
            "time_cost": flight.duration_minutes,
            "mode": "flight",
            "airline": flight.airline,
            "departure": flight.departure.isoformat(),
            "arrival": flight.arrival.isoformat(),
        }
        
        # Add best award option (lowest surcharge)
        if flight.award_programs:
            best_award = min(flight.award_programs, key=lambda x: x.get("surcharge", float('inf')))
            edge_data.update({
                "points_cost": best_award.get("miles"),
                "points_program": best_award.get("program"),
                "points_surcharge": best_award.get("surcharge"),
            })
        
        edges[edge_key] = edge_data
    
    return edges
```

---

## 4. Train Search Implementation

### 4.1 API Selection

| API | Coverage | Cost | Auth | Notes |
|-----|----------|------|------|-------|
| **Trainline** | EU, UK | Free tier | API key | Best for Europe |
| **Deutsche Bahn** | Germany, EU | Free | Open API | Good schedules |
| **SNCF** | France | Free | OAuth2 | TGV data |
| **Amtrak** | USA | Free tier | API key | US only |
| **JR East/West** | Japan | Varies | API key | Shinkansen |
| **Rome2Rio** | Global | $0.01/call | API key | Aggregator |

### 4.2 Implementation

```python
# backend/src/services/transport/train_service.py

"""
Train Service: Multi-provider train search.

Providers:
- Trainline (Europe: UK, France, Germany, Italy, Spain, etc.)
- Amtrak (USA)
- JR APIs (Japan)
- Rome2Rio (global fallback)

Search Strategy:
1. Detect region from origin/destination
2. Query appropriate regional API
3. Fall back to Rome2Rio if regional fails
4. Cache results for 30 minutes
"""

import asyncio
import httpx
from typing import Dict, List, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass
import logging

from src.services.location_service import LocationService
from src.utils.cache_layer import CacheLayer

logger = logging.getLogger(__name__)


@dataclass
class TrainOption:
    """Normalized train option from any provider."""
    train_number: str
    operator: str
    origin_station: str
    origin_name: str
    destination_station: str
    destination_name: str
    departure: datetime
    arrival: datetime
    duration_minutes: int
    price_usd: float
    cabin_class: str
    booking_url: Optional[str] = None
    source: str = ""


class TrainService:
    """
    Unified train search across regional providers.
    
    Usage:
        service = TrainService()
        trains = await service.search(
            origin="CDG",  # Can be airport code
            destination="LON",
            date="2025-03-15",
            passengers=2,
        )
    """
    
    # Region detection: Map country codes to providers
    REGION_PROVIDERS = {
        "europe": ["trainline", "rome2rio"],
        "usa": ["amtrak", "rome2rio"],
        "japan": ["jr", "rome2rio"],
        "other": ["rome2rio"],
    }
    
    # European country codes
    EU_COUNTRIES = {
        "GB", "FR", "DE", "IT", "ES", "NL", "BE", "AT", "CH", "PT",
        "IE", "DK", "SE", "NO", "FI", "PL", "CZ", "HU", "GR",
    }
    
    def __init__(self):
        self.cache = CacheLayer()
        self.location_service = LocationService()
        
        # API clients (initialized lazily)
        self._trainline = None
        self._amtrak = None
        self._jr = None
        self._rome2rio = None
    
    async def search(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
    ) -> List[TrainOption]:
        """
        Search for trains between two locations.
        
        Args:
            origin: Airport code, city code, or station code
            destination: Airport code, city code, or station code
            date: Travel date (YYYY-MM-DD)
            passengers: Number of passengers
        
        Returns:
            List of TrainOption objects, sorted by price
        
        Algorithm:
        1. Resolve origin/destination to station codes
        2. Detect region
        3. Query regional provider(s) in order of preference
        4. Fall back to Rome2Rio if needed
        5. Sort and return results
        """
        cache_key = f"trains:{origin}:{destination}:{date}:{passengers}"
        
        # Check cache
        cached = await self.cache.get(cache_key)
        if cached:
            return [TrainOption(**t) for t in cached]
        
        # Resolve to station codes
        origin_station = await self._resolve_to_station(origin)
        dest_station = await self._resolve_to_station(destination)
        
        if not origin_station or not dest_station:
            logger.warning(f"Could not resolve stations for {origin} -> {destination}")
            return []
        
        # Detect region
        region = await self._detect_region(origin, destination)
        providers = self.REGION_PROVIDERS.get(region, ["rome2rio"])
        
        # Query providers in order
        trains = []
        for provider in providers:
            try:
                if provider == "trainline":
                    trains = await self._search_trainline(origin_station, dest_station, date, passengers)
                elif provider == "amtrak":
                    trains = await self._search_amtrak(origin_station, dest_station, date, passengers)
                elif provider == "jr":
                    trains = await self._search_jr(origin_station, dest_station, date, passengers)
                elif provider == "rome2rio":
                    trains = await self._search_rome2rio(origin, destination, date, passengers)
                
                if trains:
                    break
            except Exception as e:
                logger.warning(f"Train provider {provider} failed: {e}")
                continue
        
        # Sort by price
        trains.sort(key=lambda t: t.price_usd)
        
        # Cache for 30 minutes
        await self.cache.set(cache_key, [self._to_dict(t) for t in trains], ttl=1800)
        
        return trains
    
    async def _resolve_to_station(self, code: str) -> Optional[Dict]:
        """
        Resolve airport/city code to train station.
        
        Logic:
        1. If code is already a station code, return it
        2. If code is an airport, find nearest major station
        3. If code is a city, find main station
        
        Uses Location Service to get coordinates, then finds nearby stations.
        """
        # Get location info
        location = await self.location_service.get_location(code)
        if not location:
            return None
        
        loc_type = location.get("type")  # "airport", "city", "station"
        
        if loc_type == "station":
            return location
        
        # Find station near this location
        lat = location.get("latitude")
        lon = location.get("longitude")
        city_name = location.get("city_name", location.get("name", ""))
        
        # Search for stations near these coordinates
        stations = await self._find_stations_near(lat, lon, city_name)
        
        if stations:
            return stations[0]  # Return closest station
        
        return None
    
    async def _detect_region(self, origin: str, destination: str) -> str:
        """Detect region from origin/destination."""
        origin_loc = await self.location_service.get_location(origin)
        dest_loc = await self.location_service.get_location(destination)
        
        origin_country = (origin_loc or {}).get("country_code", "")
        dest_country = (dest_loc or {}).get("country_code", "")
        
        if origin_country in self.EU_COUNTRIES and dest_country in self.EU_COUNTRIES:
            return "europe"
        if origin_country == "US" and dest_country == "US":
            return "usa"
        if origin_country == "JP" and dest_country == "JP":
            return "japan"
        
        return "other"
    
    async def _search_trainline(
        self,
        origin: Dict,
        destination: Dict,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search Trainline API.
        
        Trainline API:
        - Endpoint: POST /api/v5/search
        - Auth: Partner API key
        - Coverage: UK, France, Germany, Italy, Spain, Belgium, Netherlands, Switzerland
        
        Request:
        {
            "passengers": [{"age": 30}],
            "search": {
                "departure_station_id": "urn:trainline:generic:loc:...",
                "arrival_station_id": "urn:trainline:generic:loc:...",
                "departure_date": "2025-03-15"
            }
        }
        
        Response includes journeys with:
        - departure_time, arrival_time, duration
        - price (in original currency)
        - operator (Eurostar, TGV, ICE, etc.)
        """
        if not self._trainline:
            from src.utils.api_clients.trainline_client import TrainlineClient
            self._trainline = TrainlineClient()
        
        response = await self._trainline.search(
            origin_id=origin.get("trainline_id"),
            destination_id=destination.get("trainline_id"),
            date=date,
            passengers=passengers,
        )
        
        trains = []
        for journey in response.get("journeys", []):
            trains.append(TrainOption(
                train_number=journey.get("train_number", ""),
                operator=journey.get("operator", {}).get("name", ""),
                origin_station=origin.get("code", ""),
                origin_name=origin.get("name", ""),
                destination_station=destination.get("code", ""),
                destination_name=destination.get("name", ""),
                departure=datetime.fromisoformat(journey.get("departure_time")),
                arrival=datetime.fromisoformat(journey.get("arrival_time")),
                duration_minutes=journey.get("duration_minutes", 0),
                price_usd=self._convert_to_usd(
                    journey.get("price", {}).get("amount", 0),
                    journey.get("price", {}).get("currency", "EUR"),
                ),
                cabin_class=journey.get("class", "standard"),
                booking_url=journey.get("booking_url"),
                source="trainline",
            ))
        
        return trains
    
    async def _search_amtrak(
        self,
        origin: Dict,
        destination: Dict,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search Amtrak API.
        
        Amtrak uses GTFS data + their booking API.
        Station codes are 3-letter (e.g., "NYP" for New York Penn).
        """
        if not self._amtrak:
            from src.utils.api_clients.amtrak_client import AmtrakClient
            self._amtrak = AmtrakClient()
        
        response = await self._amtrak.search(
            origin_code=origin.get("amtrak_code"),
            destination_code=destination.get("amtrak_code"),
            date=date,
            passengers=passengers,
        )
        
        trains = []
        for train in response.get("trains", []):
            trains.append(TrainOption(
                train_number=train.get("train_number", ""),
                operator="Amtrak",
                origin_station=origin.get("code", ""),
                origin_name=origin.get("name", ""),
                destination_station=destination.get("code", ""),
                destination_name=destination.get("name", ""),
                departure=datetime.fromisoformat(train.get("departure")),
                arrival=datetime.fromisoformat(train.get("arrival")),
                duration_minutes=train.get("duration_minutes", 0),
                price_usd=train.get("fare_usd", 0),
                cabin_class=train.get("class", "coach"),
                booking_url=train.get("booking_url"),
                source="amtrak",
            ))
        
        return trains
    
    async def _search_jr(
        self,
        origin: Dict,
        destination: Dict,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search JR (Japan Rail) APIs.
        
        Japan has multiple JR companies:
        - JR East (Tokyo, northern Japan)
        - JR Central (Tokaido Shinkansen)
        - JR West (Osaka, Kyoto)
        
        Hyperdia is a good aggregator for Japan trains.
        """
        if not self._jr:
            from src.utils.api_clients.jr_client import JRClient
            self._jr = JRClient()
        
        response = await self._jr.search(
            origin_code=origin.get("jr_code"),
            destination_code=destination.get("jr_code"),
            date=date,
            passengers=passengers,
        )
        
        trains = []
        for route in response.get("routes", []):
            trains.append(TrainOption(
                train_number=route.get("train_name", ""),
                operator=route.get("operator", "JR"),
                origin_station=origin.get("code", ""),
                origin_name=origin.get("name", ""),
                destination_station=destination.get("code", ""),
                destination_name=destination.get("name", ""),
                departure=datetime.fromisoformat(route.get("departure")),
                arrival=datetime.fromisoformat(route.get("arrival")),
                duration_minutes=route.get("duration_minutes", 0),
                price_usd=route.get("fare_usd", 0),
                cabin_class=route.get("class", "ordinary"),
                booking_url=route.get("booking_url"),
                source="jr",
            ))
        
        return trains
    
    async def _search_rome2rio(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[TrainOption]:
        """
        Search Rome2Rio as fallback.
        
        Rome2Rio API:
        - Endpoint: GET /api/1.4/json/Search
        - Params: key, oName, dName, oKind=station, dKind=station
        
        Returns multi-modal options; filter for trains only.
        """
        if not self._rome2rio:
            from src.utils.api_clients.rome2rio_client import Rome2RioClient
            self._rome2rio = Rome2RioClient()
        
        response = await self._rome2rio.search(origin, destination)
        
        trains = []
        for route in response.get("routes", []):
            # Filter for train routes
            if route.get("name", "").lower() in ["train", "rail"]:
                for segment in route.get("segments", []):
                    if segment.get("kind") == "train":
                        trains.append(TrainOption(
                            train_number=segment.get("sName", ""),
                            operator=segment.get("operatingAgencies", [{}])[0].get("name", ""),
                            origin_station=origin,
                            origin_name=segment.get("sName", ""),
                            destination_station=destination,
                            destination_name=segment.get("tName", ""),
                            departure=datetime.now(),  # Rome2Rio doesn't give exact times
                            arrival=datetime.now(),
                            duration_minutes=segment.get("duration", 0),
                            price_usd=route.get("indicativePrice", {}).get("price", 0),
                            cabin_class="standard",
                            booking_url=route.get("agencies", [{}])[0].get("url"),
                            source="rome2rio",
                        ))
        
        return trains
    
    def _convert_to_usd(self, amount: float, currency: str) -> float:
        """Convert amount to USD using approximate rates."""
        rates = {
            "EUR": 1.10,
            "GBP": 1.27,
            "CHF": 1.12,
            "JPY": 0.0067,
            "USD": 1.0,
        }
        return amount * rates.get(currency, 1.0)
    
    def _to_dict(self, t: TrainOption) -> Dict:
        """Convert to dict for caching."""
        return {
            "train_number": t.train_number,
            "operator": t.operator,
            "origin_station": t.origin_station,
            "origin_name": t.origin_name,
            "destination_station": t.destination_station,
            "destination_name": t.destination_name,
            "departure": t.departure.isoformat(),
            "arrival": t.arrival.isoformat(),
            "duration_minutes": t.duration_minutes,
            "price_usd": t.price_usd,
            "cabin_class": t.cabin_class,
            "booking_url": t.booking_url,
            "source": t.source,
        }


def trains_to_edges(
    trains: List[TrainOption],
    origin: str,
    destination: str,
) -> Dict[Tuple[str, str, str], Dict]:
    """
    Convert train options to ILP edges.
    
    Train edges have:
    - mode: "train"
    - No points options (points_cost = None)
    """
    edges = {}
    
    for i, train in enumerate(trains):
        edge_key = (origin, destination, f"TRAIN_{train.operator[:4]}_{i}")
        
        edges[edge_key] = {
            "cash_cost": train.price_usd,
            "time_cost": train.duration_minutes,
            "mode": "train",
            "operator": train.operator,
            "train_number": train.train_number,
            "departure": train.departure.isoformat(),
            "arrival": train.arrival.isoformat(),
            "points_cost": None,  # Trains don't accept points
            "points_program": None,
            "points_surcharge": None,
        }
    
    return edges
```

---

## 5. Bus Search Implementation

### 5.1 API Selection

| API | Coverage | Cost | Notes |
|-----|----------|------|-------|
| **FlixBus** | EU, USA | Free | Direct API |
| **BusBud** | Global | $0.01/call | Aggregator |
| **Greyhound** | USA | Partner API | US only |
| **Megabus** | USA, UK | Scraping | Limited |

### 5.2 Implementation

```python
# backend/src/services/transport/bus_service.py

"""
Bus Service: Multi-provider bus search.

Similar structure to train service but with bus-specific providers.
"""

from typing import Dict, List, Optional, Tuple
from datetime import datetime
from dataclasses import dataclass
import asyncio
import logging

from src.utils.cache_layer import CacheLayer
from src.services.location_service import LocationService

logger = logging.getLogger(__name__)


@dataclass
class BusOption:
    """Normalized bus option."""
    bus_id: str
    operator: str
    origin: str
    origin_name: str
    destination: str
    destination_name: str
    departure: datetime
    arrival: datetime
    duration_minutes: int
    price_usd: float
    amenities: List[str]
    booking_url: Optional[str] = None
    source: str = ""


class BusService:
    """Unified bus search."""
    
    def __init__(self):
        self.cache = CacheLayer()
        self.location_service = LocationService()
    
    async def search(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int = 1,
    ) -> List[BusOption]:
        """Search for bus routes."""
        cache_key = f"buses:{origin}:{destination}:{date}:{passengers}"
        
        cached = await self.cache.get(cache_key)
        if cached:
            return [BusOption(**b) for b in cached]
        
        # Query providers in parallel
        tasks = [
            self._search_flixbus(origin, destination, date, passengers),
            self._search_busbud(origin, destination, date, passengers),
        ]
        
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        buses = []
        for result in results:
            if not isinstance(result, Exception) and result:
                buses.extend(result)
        
        # Sort by price
        buses.sort(key=lambda b: b.price_usd)
        
        # Cache for 1 hour
        await self.cache.set(cache_key, [self._to_dict(b) for b in buses], ttl=3600)
        
        return buses
    
    async def _search_flixbus(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[BusOption]:
        """
        Search FlixBus API.
        
        FlixBus API:
        - Endpoint: GET /search/service/v4/search
        - Params: from_city_id, to_city_id, departure_date, products
        
        First need to resolve location to FlixBus city IDs.
        """
        from src.utils.api_clients.flixbus_client import FlixBusClient
        client = FlixBusClient()
        
        # Resolve to FlixBus IDs
        origin_id = await client.get_city_id(origin)
        dest_id = await client.get_city_id(destination)
        
        if not origin_id or not dest_id:
            return []
        
        response = await client.search(
            origin_id=origin_id,
            destination_id=dest_id,
            date=date,
            passengers=passengers,
        )
        
        buses = []
        for trip in response.get("trips", []):
            for result in trip.get("results", []):
                buses.append(BusOption(
                    bus_id=result.get("uid", ""),
                    operator="FlixBus",
                    origin=origin,
                    origin_name=result.get("departure", {}).get("city", {}).get("name", ""),
                    destination=destination,
                    destination_name=result.get("arrival", {}).get("city", {}).get("name", ""),
                    departure=datetime.fromisoformat(result.get("departure", {}).get("date", "")),
                    arrival=datetime.fromisoformat(result.get("arrival", {}).get("date", "")),
                    duration_minutes=result.get("duration", {}).get("minutes", 0),
                    price_usd=result.get("price", {}).get("total", 0),
                    amenities=result.get("amenities", []),
                    booking_url=result.get("booking_url"),
                    source="flixbus",
                ))
        
        return buses
    
    async def _search_busbud(
        self,
        origin: str,
        destination: str,
        date: str,
        passengers: int,
    ) -> List[BusOption]:
        """
        Search BusBud API (aggregator).
        
        BusBud API:
        - Endpoint: GET /x-departures/{origin_geohash}/{dest_geohash}/{date}
        - Headers: X-Busbud-Token
        
        BusBud aggregates multiple bus companies.
        """
        from src.utils.api_clients.busbud_client import BusBudClient
        client = BusBudClient()
        
        # Get geohashes for locations
        origin_loc = await self.location_service.get_location(origin)
        dest_loc = await self.location_service.get_location(destination)
        
        if not origin_loc or not dest_loc:
            return []
        
        response = await client.search(
            origin_geohash=origin_loc.get("geohash"),
            destination_geohash=dest_loc.get("geohash"),
            date=date,
            passengers=passengers,
        )
        
        buses = []
        for dep in response.get("departures", []):
            buses.append(BusOption(
                bus_id=dep.get("id", ""),
                operator=dep.get("operator", {}).get("name", ""),
                origin=origin,
                origin_name=dep.get("origin_location", {}).get("name", ""),
                destination=destination,
                destination_name=dep.get("destination_location", {}).get("name", ""),
                departure=datetime.fromisoformat(dep.get("departure_time", "")),
                arrival=datetime.fromisoformat(dep.get("arrival_time", "")),
                duration_minutes=dep.get("duration", 0),
                price_usd=dep.get("prices", {}).get("total", 0) / 100,  # BusBud uses cents
                amenities=dep.get("amenities", []),
                booking_url=dep.get("links", {}).get("deeplink"),
                source="busbud",
            ))
        
        return buses
    
    def _to_dict(self, b: BusOption) -> Dict:
        """Convert to dict."""
        return {
            "bus_id": b.bus_id,
            "operator": b.operator,
            "origin": b.origin,
            "origin_name": b.origin_name,
            "destination": b.destination,
            "destination_name": b.destination_name,
            "departure": b.departure.isoformat(),
            "arrival": b.arrival.isoformat(),
            "duration_minutes": b.duration_minutes,
            "price_usd": b.price_usd,
            "amenities": b.amenities,
            "booking_url": b.booking_url,
            "source": b.source,
        }


def buses_to_edges(
    buses: List[BusOption],
    origin: str,
    destination: str,
) -> Dict[Tuple[str, str, str], Dict]:
    """Convert bus options to ILP edges."""
    edges = {}
    
    for i, bus in enumerate(buses):
        edge_key = (origin, destination, f"BUS_{bus.operator[:4]}_{i}")
        
        edges[edge_key] = {
            "cash_cost": bus.price_usd,
            "time_cost": bus.duration_minutes,
            "mode": "bus",
            "operator": bus.operator,
            "departure": bus.departure.isoformat(),
            "arrival": bus.arrival.isoformat(),
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
        }
    
    return edges
```

---

## 6. Credit Card Benefits System

### 6.1 Database Schema

```python
# DynamoDB table definitions

CARD_TABLES = {
    "tripy-credit-cards": {
        "KeySchema": [{"AttributeName": "PK", "KeyType": "HASH"}],
        # PK: CARD#<card_id>
        # Attributes: issuer, name, annual_fee, points_program
    },
    
    "tripy-card-benefits": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        # PK: CARD#<card_id>
        # SK: BENEFIT#<benefit_id>
        # Attributes: benefit_type, benefit_value (JSON), conditions (JSON)
    },
    
    "tripy-user-cards": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},
            {"AttributeName": "SK", "KeyType": "RANGE"},
        ],
        # PK: USER#<user_id>
        # SK: CARD#<card_id>
    },
}
```

### 6.2 Benefit Types

```python
# backend/src/models/card_benefits.py

from enum import Enum
from typing import Dict, Any, List
from dataclasses import dataclass


class BenefitType(Enum):
    """All supported credit card benefit types."""
    
    # Baggage
    FREE_CHECKED_BAG = "free_checked_bag"
    FREE_CARRY_ON = "free_carry_on"
    
    # Lounge
    LOUNGE_ACCESS = "lounge_access"
    
    # Credits
    AIRLINE_CREDIT = "airline_credit"
    TRAVEL_CREDIT = "travel_credit"
    
    # Status
    ELITE_STATUS = "elite_status"
    PRIORITY_BOARDING = "priority_boarding"
    
    # Companion
    COMPANION_CERTIFICATE = "companion_certificate"


@dataclass
class CardBenefit:
    """Represents a single card benefit."""
    benefit_id: str
    card_id: str
    benefit_type: BenefitType
    value_config: Dict[str, Any]
    conditions: Dict[str, Any]
    
    def calculate_value(
        self,
        edge: Dict,
        passengers: int,
        is_cardholder_on_booking: bool,
    ) -> float:
        """
        Calculate monetary value of this benefit for a specific edge.
        
        Logic varies by benefit type:
        - FREE_CHECKED_BAG: bags × bag_fee × applicable_passengers
        - LOUNGE_ACCESS: estimated_value × (1 + guests)
        - AIRLINE_CREDIT: min(remaining_credit, applicable_amount)
        """
        if self.benefit_type == BenefitType.FREE_CHECKED_BAG:
            return self._calc_free_bag(edge, passengers, is_cardholder_on_booking)
        elif self.benefit_type == BenefitType.LOUNGE_ACCESS:
            return self._calc_lounge(edge, passengers)
        elif self.benefit_type == BenefitType.AIRLINE_CREDIT:
            return self._calc_credit(edge)
        # ... other types
        return 0.0
    
    def _calc_free_bag(self, edge: Dict, passengers: int, is_cardholder: bool) -> float:
        """
        Calculate free bag benefit.
        
        Example config:
        {
            "bags_per_person": 1,
            "applies_to": "booking_party",  # or "cardholder_only"
            "bag_value_usd": 35,
        }
        """
        if not self._check_conditions(edge):
            return 0.0
        
        bags_per = self.value_config.get("bags_per_person", 1)
        applies_to = self.value_config.get("applies_to", "cardholder_only")
        bag_value = self.value_config.get("bag_value_usd", 35)
        
        if applies_to == "booking_party":
            return bags_per * passengers * bag_value
        else:
            return bags_per * bag_value if is_cardholder else 0.0
    
    def _calc_lounge(self, edge: Dict, passengers: int) -> float:
        """
        Calculate lounge access value.
        
        Example config:
        {
            "lounge_network": "priority_pass",
            "guests_included": 2,
            "estimated_value_usd": 32,
        }
        """
        if not self._check_conditions(edge):
            return 0.0
        
        # Check if lounge exists at departure airport
        # (Would query lounge database)
        
        guests = min(self.value_config.get("guests_included", 0), passengers - 1)
        value_per = self.value_config.get("estimated_value_usd", 32)
        
        return (1 + guests) * value_per
    
    def _calc_credit(self, edge: Dict) -> float:
        """
        Calculate airline/travel credit value.
        
        Example config:
        {
            "annual_credit_usd": 200,
            "selected_airline": "DL",  # or None for any
            "covers": ["baggage", "seat_selection"],
        }
        """
        if not self._check_conditions(edge):
            return 0.0
        
        selected = self.value_config.get("selected_airline")
        if selected and edge.get("airline") != selected:
            return 0.0
        
        # Return estimated applicable amount (would track actual usage)
        return min(50, self.value_config.get("annual_credit_usd", 0))
    
    def _check_conditions(self, edge: Dict) -> bool:
        """Check if benefit conditions are met for this edge."""
        airline = edge.get("airline", "")
        
        # Check airline condition
        if "airlines" in self.conditions:
            if airline not in self.conditions["airlines"]:
                return False
        
        # Check cabin class
        if "cabin_classes" in self.conditions:
            cabin = edge.get("cabin", "economy")
            if cabin not in self.conditions["cabin_classes"]:
                return False
        
        return True
```

### 6.3 Benefits Service

```python
# backend/src/services/card_service.py

from typing import Dict, List, Tuple, Any
from src.repos.card_repo import CardRepo
from src.repos.benefit_repo import BenefitRepo
from src.repos.user_card_repo import UserCardRepo
from src.models.card_benefits import CardBenefit, BenefitType


class CardBenefitsService:
    """
    Service for calculating card benefits.
    
    Usage:
        service = CardBenefitsService()
        benefits = await service.calculate_benefits_for_edges(
            edges=edges_dict,
            user_id="user123",
            passengers=2,
        )
    """
    
    def __init__(self):
        self.card_repo = CardRepo()
        self.benefit_repo = BenefitRepo()
        self.user_card_repo = UserCardRepo()
    
    async def calculate_benefits_for_edges(
        self,
        edges: Dict[Tuple, Dict],
        user_id: str,
        passengers: int,
    ) -> Dict[Tuple, Dict[str, List[Dict]]]:
        """
        Calculate all applicable card benefits for each edge.
        
        Returns:
            {edge: {card_id: [{benefit_type, value, description}]}}
        """
        # Get user's cards
        user_cards = await self.user_card_repo.get_user_cards(user_id)
        
        if not user_cards:
            return {}
        
        # Load card benefits
        card_benefits = {}
        for uc in user_cards:
            card_id = uc["card_id"]
            benefits_data = await self.benefit_repo.get_benefits_for_card(card_id)
            card_benefits[card_id] = [
                CardBenefit(
                    benefit_id=b["benefit_id"],
                    card_id=card_id,
                    benefit_type=BenefitType(b["benefit_type"]),
                    value_config=b.get("benefit_value", {}),
                    conditions=b.get("conditions", {}),
                )
                for b in benefits_data
            ]
        
        # Calculate benefits for each edge
        result = {}
        
        for edge_key, edge_data in edges.items():
            result[edge_key] = {}
            
            for card_id, benefits in card_benefits.items():
                edge_benefits = []
                
                for benefit in benefits:
                    value = benefit.calculate_value(
                        edge=edge_data,
                        passengers=passengers,
                        is_cardholder_on_booking=True,
                    )
                    
                    if value > 0:
                        edge_benefits.append({
                            "benefit_type": benefit.benefit_type.value,
                            "monetary_value": value,
                            "description": self._describe_benefit(benefit, value),
                        })
                
                if edge_benefits:
                    result[edge_key][card_id] = edge_benefits
        
        return result
    
    def _describe_benefit(self, benefit: CardBenefit, value: float) -> str:
        """Generate human-readable description."""
        if benefit.benefit_type == BenefitType.FREE_CHECKED_BAG:
            bags = benefit.value_config.get("bags_per_person", 1)
            return f"{bags} free checked bag(s) (${value:.0f} value)"
        elif benefit.benefit_type == BenefitType.LOUNGE_ACCESS:
            return f"Lounge access (${value:.0f} value)"
        elif benefit.benefit_type == BenefitType.AIRLINE_CREDIT:
            return f"Up to ${value:.0f} airline credit"
        return f"${value:.0f} benefit"
```

---

## 7. Transfer Partner System

### 7.1 Database Schema

```python
# DynamoDB table: tripy-transfer-partners

TRANSFER_PARTNER_SCHEMA = {
    "KeySchema": [
        {"AttributeName": "PK", "KeyType": "HASH"},   # SOURCE#<program>
        {"AttributeName": "SK", "KeyType": "RANGE"},  # DEST#<airline>
    ],
    "Attributes": {
        "transfer_ratio": "N",      # 1.0 = 1:1
        "bonus_ratio": "N",         # Current promotion (1.25 = 25% bonus)
        "bonus_expires_at": "S",    # ISO timestamp or null
        "min_transfer": "N",        # Minimum points (usually 1000)
        "transfer_time_days": "N",  # Days to transfer (usually instant to 3)
        "is_active": "BOOL",
    }
}

# Example records:
SAMPLE_PARTNERS = [
    # Chase Ultimate Rewards
    {"PK": "SOURCE#chase_ur", "SK": "DEST#UA", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#chase_ur", "SK": "DEST#BA", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#chase_ur", "SK": "DEST#SQ", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#chase_ur", "SK": "DEST#VS", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#chase_ur", "SK": "DEST#AF", "transfer_ratio": 1.0, "is_active": True},
    
    # Amex Membership Rewards
    {"PK": "SOURCE#amex_mr", "SK": "DEST#DL", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#amex_mr", "SK": "DEST#BA", "transfer_ratio": 1.0, "is_active": True},
    {"PK": "SOURCE#amex_mr", "SK": "DEST#AV", "transfer_ratio": 1.0, "is_active": True},
    
    # Example with bonus
    {"PK": "SOURCE#amex_mr", "SK": "DEST#VS", "transfer_ratio": 1.0, 
     "bonus_ratio": 1.30, "bonus_expires_at": "2025-03-31T23:59:59Z", "is_active": True},
]
```

### 7.2 Transfer Service

```python
# backend/src/services/transfer_service.py

from typing import Dict, Set, Tuple
from datetime import datetime
from src.repos.transfer_partner_repo import TransferPartnerRepo


class TransferService:
    """
    Service for managing transfer partners and building transfer graphs.
    
    The transfer graph is used by the ILP to determine:
    - Which bank points can transfer to which airlines
    - The transfer ratio (usually 1:1)
    - Any active bonuses (e.g., 25% bonus to Virgin Atlantic)
    """
    
    def __init__(self):
        self.repo = TransferPartnerRepo()
    
    async def get_transfer_graph(self) -> Dict[str, Dict[str, float]]:
        """
        Get the current transfer graph.
        
        Returns:
            {bank: {airline: effective_ratio}}
            
        Example:
            {
                "chase_ur": {"UA": 1.0, "BA": 1.0, "SQ": 1.0},
                "amex_mr": {"DL": 1.0, "VS": 1.3},  # VS has 30% bonus
            }
        """
        all_partners = await self.repo.get_all_partners()
        
        graph = {}
        now = datetime.now()
        
        for p in all_partners:
            if not p.get("is_active", True):
                continue
            
            source = p["PK"].replace("SOURCE#", "")
            dest = p["SK"].replace("DEST#", "")
            
            # Calculate effective ratio with bonus
            base_ratio = float(p.get("transfer_ratio", 1.0))
            bonus_ratio = float(p.get("bonus_ratio", 1.0))
            bonus_expires = p.get("bonus_expires_at")
            
            if bonus_expires:
                expires = datetime.fromisoformat(bonus_expires.replace("Z", "+00:00"))
                if now < expires:
                    effective_ratio = base_ratio * bonus_ratio
                else:
                    effective_ratio = base_ratio
            else:
                effective_ratio = base_ratio * bonus_ratio
            
            if source not in graph:
                graph[source] = {}
            graph[source][dest] = effective_ratio
        
        return graph
    
    async def get_allowed_transfers(self) -> Set[Tuple[str, str]]:
        """
        Get set of allowed (bank, airline) transfer pairs.
        
        Used for ILP `allowed_sa` parameter.
        """
        graph = await self.get_transfer_graph()
        return {(bank, airline) for bank, airlines in graph.items() for airline in airlines}
    
    async def update_bonus(
        self,
        source: str,
        airline: str,
        bonus_ratio: float,
        expires_at: str,
    ) -> None:
        """
        Update transfer bonus (for promotions).
        
        Example: "Chase to United 25% bonus through March 31"
        """
        await self.repo.update_bonus(
            source=source,
            airline=airline,
            bonus_ratio=bonus_ratio,
            expires_at=expires_at,
        )
```

---

## 8. Location Resolution System

### 8.1 Overview

The location system resolves various input formats to standard codes:
- "New York" → {"JFK", "LGA", "EWR"}
- "CDG" → Airport info
- "Paris" → City info with nearby airports

### 8.2 Implementation

```python
# backend/src/services/location_service.py

from typing import Dict, List, Optional, Any
from src.utils.cache_layer import CacheLayer
from src.utils.api_clients.amadeus_client import AmadeusClient
import re


class LocationService:
    """
    Service for resolving locations (cities, airports, stations).
    
    Uses multiple sources:
    1. Amadeus API (primary for airports/cities)
    2. Local CSV data (fallback)
    3. OpenAI (last resort for ambiguous queries)
    """
    
    def __init__(self):
        self.cache = CacheLayer()
        self.amadeus = AmadeusClient()
    
    async def get_location(self, query: str) -> Optional[Dict[str, Any]]:
        """
        Get location info for a query.
        
        Args:
            query: Airport code, city name, or station code
        
        Returns:
            {
                "code": "JFK",
                "name": "John F. Kennedy International Airport",
                "type": "airport",  # or "city", "station"
                "city_name": "New York",
                "country_code": "US",
                "latitude": 40.6413,
                "longitude": -73.7781,
            }
        """
        query = query.strip().upper()
        
        # Check cache
        cache_key = f"location:{query}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        # If it looks like an airport code (3 letters)
        if re.match(r'^[A-Z]{3}$', query):
            result = await self._lookup_airport(query)
        else:
            result = await self._search_location(query)
        
        if result:
            await self.cache.set(cache_key, result, ttl=86400)  # 24 hours
        
        return result
    
    async def get_airports_for_city(self, city_code: str) -> List[Dict]:
        """
        Get all airports serving a city.
        
        Example: "NYC" → [JFK, LGA, EWR]
        """
        cache_key = f"city_airports:{city_code}"
        cached = await self.cache.get(cache_key)
        if cached:
            return cached
        
        # Query Amadeus
        airports = await self.amadeus.get_airports_for_city(city_code)
        
        if airports:
            await self.cache.set(cache_key, airports, ttl=86400)
        
        return airports
    
    async def _lookup_airport(self, code: str) -> Optional[Dict]:
        """Look up a specific airport by IATA code."""
        try:
            result = await self.amadeus.get_airport(code)
            if result:
                return {
                    "code": code,
                    "name": result.get("name"),
                    "type": "airport",
                    "city_name": result.get("address", {}).get("cityName"),
                    "country_code": result.get("address", {}).get("countryCode"),
                    "latitude": result.get("geoCode", {}).get("latitude"),
                    "longitude": result.get("geoCode", {}).get("longitude"),
                }
        except:
            pass
        
        # Fallback to CSV
        return self._lookup_csv(code)
    
    async def _search_location(self, query: str) -> Optional[Dict]:
        """Search for a location by name."""
        try:
            results = await self.amadeus.search_locations(query)
            if results:
                r = results[0]
                return {
                    "code": r.get("iataCode"),
                    "name": r.get("name"),
                    "type": r.get("subType", "").lower(),  # "AIRPORT", "CITY"
                    "city_name": r.get("address", {}).get("cityName"),
                    "country_code": r.get("address", {}).get("countryCode"),
                    "latitude": r.get("geoCode", {}).get("latitude"),
                    "longitude": r.get("geoCode", {}).get("longitude"),
                }
        except:
            pass
        
        return None
    
    def _lookup_csv(self, code: str) -> Optional[Dict]:
        """Fallback lookup from local CSV."""
        # Load from files/airports.csv
        # This is pre-loaded at startup
        from src.data.airports import AIRPORTS_BY_CODE
        return AIRPORTS_BY_CODE.get(code)
```

---

## 9. Database Schema

### 9.1 Complete DynamoDB Tables

```python
# backend/src/repos/dynamodb_schema.py

TABLES = {
    # ═══════════════════════════════════════════════════════════════════
    # EXISTING TABLES
    # ═══════════════════════════════════════════════════════════════════
    
    "tripy-users": {
        "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}],
        "Attributes": ["email", "name", "homeAirport", "createdAt"],
    },
    
    "tripy-trips": {
        "KeySchema": [{"AttributeName": "tripId", "KeyType": "HASH"}],
        "GSI": [{"IndexName": "inviteCode-index", "KeySchema": [{"AttributeName": "inviteCode", "KeyType": "HASH"}]}],
        "Attributes": ["userId", "type", "origin", "startDate", "endDate", "travelers", "budget", "inviteCode"],
    },
    
    "tripy-trip-members": {
        "KeySchema": [
            {"AttributeName": "tripId", "KeyType": "HASH"},
            {"AttributeName": "userId", "KeyType": "RANGE"},
        ],
        "GSI": [{"IndexName": "userId-index", "KeySchema": [{"AttributeName": "userId", "KeyType": "HASH"}]}],
        "Attributes": ["role", "status", "joinedAt"],
    },
    
    "tripy-points": {
        "KeySchema": [{"AttributeName": "pk", "KeyType": "HASH"}],  # userId#programId#tripId
        "Attributes": ["userId", "programId", "tripId", "balance"],
    },
    
    "tripy-destinations": {
        "KeySchema": [
            {"AttributeName": "tripId", "KeyType": "HASH"},
            {"AttributeName": "destinationId", "KeyType": "RANGE"},
        ],
        "Attributes": ["name", "city", "country", "isStart", "isEnd", "excluded"],
    },
    
    "tripy-itineraries": {
        "KeySchema": [{"AttributeName": "tripId", "KeyType": "HASH"}],
        "Attributes": ["solution", "items", "totals", "createdAt"],
    },
    
    # ═══════════════════════════════════════════════════════════════════
    # NEW TABLES (v5)
    # ═══════════════════════════════════════════════════════════════════
    
    "tripy-credit-cards": {
        "KeySchema": [{"AttributeName": "PK", "KeyType": "HASH"}],  # CARD#<card_id>
        "GSI": [{"IndexName": "issuer-index", "KeySchema": [{"AttributeName": "issuer", "KeyType": "HASH"}]}],
        "Attributes": ["issuer", "name", "annual_fee", "points_program", "image_url"],
    },
    
    "tripy-card-benefits": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # CARD#<card_id>
            {"AttributeName": "SK", "KeyType": "RANGE"},  # BENEFIT#<benefit_id>
        ],
        "GSI": [{"IndexName": "type-index", "KeySchema": [{"AttributeName": "benefit_type", "KeyType": "HASH"}]}],
        "Attributes": ["benefit_type", "benefit_value", "conditions"],
    },
    
    "tripy-user-cards": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # USER#<user_id>
            {"AttributeName": "SK", "KeyType": "RANGE"},  # CARD#<card_id>
        ],
        "Attributes": ["card_id", "is_primary", "added_at"],
    },
    
    "tripy-transfer-partners": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # SOURCE#<program>
            {"AttributeName": "SK", "KeyType": "RANGE"},  # DEST#<airline>
        ],
        "Attributes": ["transfer_ratio", "bonus_ratio", "bonus_expires_at", "min_transfer", "transfer_time_days", "is_active"],
    },
    
    "tripy-station-cache": {
        "KeySchema": [
            {"AttributeName": "PK", "KeyType": "HASH"},   # PROVIDER#<provider>
            {"AttributeName": "SK", "KeyType": "RANGE"},  # CODE#<code>
        ],
        "TTL": {"AttributeName": "ttl", "Enabled": True},
        "Attributes": ["code", "name", "latitude", "longitude", "country", "provider_id"],
    },
    
    "tripy-regions": {
        "KeySchema": [{"AttributeName": "PK", "KeyType": "HASH"}],  # REGION#<name>
        "Attributes": ["name", "country_codes"],
    },
}
```

---

## 10. API Layer Implementation

### 10.1 New Endpoints

```python
# backend/src/app.py (additions)

from fastapi import FastAPI, Depends, HTTPException, Query
from src.services.card_service import CardBenefitsService
from src.services.transfer_service import TransferService
from src.services.transport.flight_service import FlightService
from src.services.transport.train_service import TrainService
from src.services.transport.bus_service import BusService

app = FastAPI(title="Tripy API", version="5.0")

# ═══════════════════════════════════════════════════════════════════════
# TRANSPORT SEARCH
# ═══════════════════════════════════════════════════════════════════════

@app.get("/api/transport/search")
async def search_transport(
    origin: str,
    destination: str,
    date: str,
    modes: List[str] = Query(default=["flight", "train", "bus"]),
    passengers: int = 1,
):
    """
    Search all transport modes between two locations.
    
    Returns unified list of options with out-of-pocket costs.
    """
    results = []
    
    if "flight" in modes:
        flight_service = FlightService()
        flights = await flight_service.search(origin, destination, date, passengers)
        results.extend([{
            "mode": "flight",
            "flight_number": f.flight_number,
            "airline": f.airline,
            "departure": f.departure.isoformat(),
            "arrival": f.arrival.isoformat(),
            "duration_minutes": f.duration_minutes,
            "cash_price": f.cash_price,
            "award_options": f.award_programs,
        } for f in flights])
    
    if "train" in modes:
        train_service = TrainService()
        trains = await train_service.search(origin, destination, date, passengers)
        results.extend([{
            "mode": "train",
            "operator": t.operator,
            "train_number": t.train_number,
            "departure": t.departure.isoformat(),
            "arrival": t.arrival.isoformat(),
            "duration_minutes": t.duration_minutes,
            "price_usd": t.price_usd,
        } for t in trains])
    
    if "bus" in modes:
        bus_service = BusService()
        buses = await bus_service.search(origin, destination, date, passengers)
        results.extend([{
            "mode": "bus",
            "operator": b.operator,
            "departure": b.departure.isoformat(),
            "arrival": b.arrival.isoformat(),
            "duration_minutes": b.duration_minutes,
            "price_usd": b.price_usd,
        } for b in buses])
    
    # Sort by out-of-pocket cost
    def get_oop(r):
        if r["mode"] == "flight":
            cash = r.get("cash_price") or float('inf')
            if r.get("award_options"):
                min_sur = min(a.get("surcharge", float('inf')) for a in r["award_options"])
                return min(cash, min_sur)
            return cash
        return r.get("price_usd", float('inf'))
    
    results.sort(key=get_oop)
    return {"results": results}


# ═══════════════════════════════════════════════════════════════════════
# CREDIT CARDS
# ═══════════════════════════════════════════════════════════════════════

@app.get("/api/cards")
async def list_cards():
    """List all available credit cards."""
    from src.repos.card_repo import CardRepo
    repo = CardRepo()
    cards = await repo.get_all_cards()
    return {"cards": cards}


@app.get("/api/cards/{card_id}")
async def get_card(card_id: str):
    """Get card details with benefits."""
    from src.repos.card_repo import CardRepo
    from src.repos.benefit_repo import BenefitRepo
    
    card_repo = CardRepo()
    benefit_repo = BenefitRepo()
    
    card = await card_repo.get_card(card_id)
    if not card:
        raise HTTPException(404, "Card not found")
    
    benefits = await benefit_repo.get_benefits_for_card(card_id)
    
    return {"card": card, "benefits": benefits}


@app.get("/api/users/me/cards")
async def get_my_cards(user=Depends(get_current_user)):
    """Get current user's cards."""
    from src.repos.user_card_repo import UserCardRepo
    repo = UserCardRepo()
    return {"cards": await repo.get_user_cards(user["userId"])}


@app.post("/api/users/me/cards/{card_id}")
async def add_my_card(card_id: str, user=Depends(get_current_user)):
    """Add a card to user's wallet."""
    from src.repos.user_card_repo import UserCardRepo
    repo = UserCardRepo()
    await repo.add_user_card(user["userId"], card_id)
    return {"success": True}


@app.delete("/api/users/me/cards/{card_id}")
async def remove_my_card(card_id: str, user=Depends(get_current_user)):
    """Remove a card from user's wallet."""
    from src.repos.user_card_repo import UserCardRepo
    repo = UserCardRepo()
    await repo.remove_user_card(user["userId"], card_id)
    return {"success": True}


# ═══════════════════════════════════════════════════════════════════════
# TRANSFER PARTNERS
# ═══════════════════════════════════════════════════════════════════════

@app.get("/api/transfer-partners")
async def get_transfer_partners():
    """Get current transfer partner graph with active bonuses."""
    service = TransferService()
    graph = await service.get_transfer_graph()
    return {"partners": graph}


# ═══════════════════════════════════════════════════════════════════════
# ADMIN ENDPOINTS
# ═══════════════════════════════════════════════════════════════════════

@app.post("/admin/cards", dependencies=[Depends(admin_only)])
async def create_card(card: CardCreate):
    """Add a new credit card to the system."""
    from src.repos.card_repo import CardRepo
    repo = CardRepo()
    await repo.create_card(card.dict())
    return {"success": True}


@app.post("/admin/cards/{card_id}/benefits", dependencies=[Depends(admin_only)])
async def add_benefit(card_id: str, benefit: BenefitCreate):
    """Add a benefit to a card."""
    from src.repos.benefit_repo import BenefitRepo
    repo = BenefitRepo()
    await repo.create_benefit(card_id, benefit.dict())
    return {"success": True}


@app.put("/admin/transfer-partners/{source}/{airline}", dependencies=[Depends(admin_only)])
async def update_transfer_partner(source: str, airline: str, data: TransferPartnerUpdate):
    """Update transfer partner (e.g., add bonus promotion)."""
    service = TransferService()
    await service.update_bonus(source, airline, data.bonus_ratio, data.expires_at)
    return {"success": True}
```

---

## 11. Performance Optimizations

### 11.1 Caching Strategy

```python
# Cache TTLs by data type
CACHE_CONFIG = {
    "flight_award": 900,      # 15 min (award availability changes)
    "flight_cash": 1800,      # 30 min (cash prices somewhat stable)
    "train": 1800,            # 30 min
    "bus": 3600,              # 1 hour (bus prices very stable)
    "location": 86400,        # 24 hours (locations don't change)
    "station": 2592000,       # 30 days (station data very stable)
    "card": 86400,            # 24 hours (card benefits rarely change)
    "transfer_partner": 3600,  # 1 hour (bonuses may start/end)
}
```

### 11.2 Parallel API Calls

```python
async def fetch_all_transport(pairs, date, passengers):
    """Fetch all transport options in parallel."""
    sem = asyncio.Semaphore(10)  # Limit concurrent calls
    
    async def fetch_pair(origin, destination):
        async with sem:
            flight_task = flight_service.search(origin, destination, date, passengers)
            train_task = train_service.search(origin, destination, date, passengers)
            bus_task = bus_service.search(origin, destination, date, passengers)
            
            return await asyncio.gather(
                flight_task, train_task, bus_task,
                return_exceptions=True
            )
    
    results = await asyncio.gather(
        *[fetch_pair(o, d) for o, d in pairs],
        return_exceptions=True
    )
    
    return results
```

### 11.3 Edge Pruning

```python
def prune_edges(edges_dict, max_per_od=10):
    """
    Keep only top N edges per origin-destination pair.
    
    Selection criteria:
    1. Lowest out-of-pocket (surcharge for points, cash for others)
    2. Shortest time
    3. Different modes (keep at least one of each mode)
    """
    by_od = defaultdict(list)
    for e, d in edges_dict.items():
        by_od[(e[0], e[1])].append((e, d))
    
    pruned = {}
    for od, candidates in by_od.items():
        # Sort by out-of-pocket
        def oop(ed):
            e, d = ed
            sur = d.get("points_surcharge")
            cash = d.get("cash_cost", float('inf'))
            return min(sur, cash) if sur else cash
        
        candidates.sort(key=oop)
        
        # Keep top N, ensuring mode diversity
        kept = []
        modes_seen = set()
        
        for e, d in candidates:
            mode = d.get("mode", "flight")
            if len(kept) < max_per_od or mode not in modes_seen:
                kept.append((e, d))
                modes_seen.add(mode)
            
            if len(kept) >= max_per_od and len(modes_seen) >= 3:
                break
        
        for e, d in kept:
            pruned[e] = d
    
    return pruned
```

---

## 12. Error Handling & Fallbacks

### 12.1 API Fallback Chain

```python
async def search_flights_with_fallback(origin, destination, date, passengers):
    """
    Search flights with fallback chain.
    
    Order:
    1. AwardTool (best for award data)
    2. Amadeus (best for schedules)
    3. SerpAPI (best for prices)
    4. OpenAI estimation (last resort)
    """
    # Try AwardTool
    try:
        results = await awardtool_client.search(origin, destination, date, passengers)
        if results:
            return results
    except Exception as e:
        logger.warning(f"AwardTool failed: {e}")
    
    # Try Amadeus
    try:
        results = await amadeus_client.search(origin, destination, date, passengers)
        if results:
            return results
    except Exception as e:
        logger.warning(f"Amadeus failed: {e}")
    
    # Try SerpAPI
    try:
        results = await serpapi_client.search(origin, destination, date, passengers)
        if results:
            return results
    except Exception as e:
        logger.warning(f"SerpAPI failed: {e}")
    
    # Last resort: OpenAI estimation
    try:
        estimation = await openai_estimate_flight(origin, destination, date)
        return [estimation]
    except Exception as e:
        logger.error(f"All flight searches failed for {origin}->{destination}")
        return []
```

### 12.2 Graceful Degradation

```python
async def generate_itinerary_with_fallbacks(trip_id):
    """
    Generate itinerary with graceful degradation.
    
    If full optimization fails:
    1. Try with reduced must-visit cities
    2. Try with increased budget
    3. Return partial solution
    """
    try:
        return await generate_optimized_itinerary(trip_id)
    except InfeasibleError:
        # Try removing optional destinations
        return await generate_with_reduced_destinations(trip_id)
    except TimeoutError:
        # Try with fewer edges (faster)
        return await generate_with_pruned_edges(trip_id)
    except Exception as e:
        # Return best-effort partial solution
        logger.error(f"Itinerary generation failed: {e}")
        return await generate_simple_itinerary(trip_id)
```

---

## 13. Testing Strategy

### 13.1 Unit Tests

```python
# tests/test_ilp_optimizer.py

import pytest
from src.handlers.points_minimizer import OutOfPocketMinimizer


class TestOutOfPocketMinimizer:
    
    def test_prefers_points_when_surcharge_lower(self):
        """Should choose points over cash when surcharge < cash."""
        optimizer = OutOfPocketMinimizer()
        
        result = optimizer.optimize(
            travelers=["user1"],
            edges=[("SEA", "NRT", "UA123")],
            cash_cost={("SEA", "NRT", "UA123"): 850},
            award_points={"UA": {("SEA", "NRT", "UA123"): 70000}},
            cash_surcharge={"UA": {("SEA", "NRT", "UA123"): 50}},
            # ... other params
        )
        
        assert result.status == "Optimal"
        assert result.pay_mode["user1"][0]["type"] == "points"
        assert result.totals["cash"] == 50  # Only surcharge
    
    def test_prefers_cash_when_surcharge_higher(self):
        """Should choose cash over points when surcharge > cash."""
        optimizer = OutOfPocketMinimizer()
        
        result = optimizer.optimize(
            travelers=["user1"],
            edges=[("LON", "DUB", "BA456")],
            cash_cost={("LON", "DUB", "BA456"): 80},
            award_points={"BA": {("LON", "DUB", "BA456"): 9000}},
            cash_surcharge={"BA": {("LON", "DUB", "BA456"): 150}},
            # ... other params
        )
        
        assert result.status == "Optimal"
        assert result.pay_mode["user1"][0]["type"] == "cash"
        assert result.totals["cash"] == 80
    
    def test_card_benefits_reduce_effective_cost(self):
        """Card benefits should reduce effective cost."""
        optimizer = OutOfPocketMinimizer()
        
        result = optimizer.optimize(
            travelers=["user1"],
            edges=[("ATL", "LAX", "DL789")],
            cash_cost={("ATL", "LAX", "DL789"): 300},
            user_cards={"user1": ["amex_delta_gold"]},
            edge_benefits={
                ("ATL", "LAX", "DL789"): {
                    "amex_delta_gold": [
                        EdgeBenefit("b1", "amex_delta_gold", BenefitType.FREE_CHECKED_BAG, 70, "2 free bags")
                    ]
                }
            },
            # ... other params
        )
        
        assert result.totals["benefits_value"] == 70
        assert result.totals["effective_cost"] == 300 - 70
```

### 13.2 Integration Tests

```python
# tests/test_itinerary_integration.py

@pytest.mark.asyncio
async def test_full_itinerary_generation():
    """End-to-end test of itinerary generation."""
    # Create trip
    trip_id = await create_test_trip(
        start="Seattle",
        destinations=["Tokyo", "Kyoto"],
        end="Seattle",
        date="2025-03-15",
    )
    
    # Add points
    await add_test_points(trip_id, "user1", {
        "Chase Ultimate Rewards": 200000,
    })
    
    # Add cards
    await add_test_card("user1", "chase_sapphire_reserve")
    
    # Generate itinerary
    result = await generate_optimized_itinerary(trip_id)
    
    # Assertions
    assert result["status"] == "Optimal"
    assert result["out_of_pocket"] < 500  # Should be cheap with 200k points
    assert result["benefits_value"] > 0   # Should have lounge benefit
```

---

## 14. Deployment Configuration

### 14.1 Environment Variables

```bash
# .env.production

# AWS
AWS_REGION=us-east-1
DYNAMODB_ENDPOINT=https://dynamodb.us-east-1.amazonaws.com

# Flight APIs
AWARDTOOL_API_KEY=xxx
AMADEUS_API_KEY=xxx
AMADEUS_API_SECRET=xxx
SERPAPI_API_KEY=xxx

# Train APIs
TRAINLINE_API_KEY=xxx
AMTRAK_API_KEY=xxx
JR_API_KEY=xxx

# Bus APIs
FLIXBUS_API_KEY=xxx
BUSBUD_API_KEY=xxx

# Multi-modal
ROME2RIO_API_KEY=xxx

# Caching
REDIS_URL=redis://xxx:6379

# AI
OPENAI_API_KEY=xxx

# Optimization
ILP_SOLVER_TIMEOUT=30
MAX_EDGES_PER_OD=10
CACHE_ENABLED=true
```

### 14.2 AWS App Runner

```yaml
# apprunner.yaml
version: 1.0
runtime: python311
build:
  commands:
    build:
      - pip install -r requirements.txt
run:
  command: uvicorn src.app:app --host 0.0.0.0 --port 8000
  network:
    port: 8000
  env:
    - name: PYTHONPATH
      value: /app/backend
    - name: ILP_SOLVER
      value: CBC
```

---

## Summary

### Implementation Checklist

| Component | Status | Priority |
|-----------|--------|----------|
| ILP Optimizer v5 (minimize out-of-pocket) | 📋 To implement | P0 |
| Flight Service (multi-provider) | 📋 To implement | P0 |
| Train Service (Trainline, Amtrak, JR) | 📋 To implement | P1 |
| Bus Service (FlixBus, BusBud) | 📋 To implement | P1 |
| Card Benefits System | 📋 To implement | P1 |
| Transfer Partner System | 📋 To implement | P1 |
| Location Resolution | ✅ Exists (enhance) | P2 |
| Caching Layer | 📋 To implement | P1 |
| Admin API | 📋 To implement | P2 |
| Testing Suite | 📋 To implement | P1 |

### Key Metrics to Track

| Metric | Target |
|--------|--------|
| ILP solve time | < 5 seconds |
| API response time | < 2 seconds |
| Cache hit rate | > 80% |
| Error rate | < 1% |
| Out-of-pocket savings | > 50% vs cash |

---

*Document Version: 5.0*
*Last Updated: January 2026*
*Total Lines: ~3500*
