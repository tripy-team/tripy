# Points Optimization Implementation Plan: Minimizing Out-of-Pocket Costs

## Executive Summary

This implementation plan details how to build an intelligent travel optimization system that **minimizes out-of-pocket (OOP) costs** by strategically using points across:
- **Direct flights** and **connecting flights** (1-stop, 2-stop itineraries)
- **Positioning flights** to major hubs with better award availability
- **Partner award routing** to avoid high surcharges
- **Hotel bookings** coordinated with flights
- **Smart points transfers** from credit cards to loyalty programs

---

## Table of Contents

1. [Core Optimization Philosophy: OOP vs CPP](#1-core-optimization-philosophy-oop-vs-cpp)
2. [Flight Routing Strategy: Direct, Connecting, and Positioning](#2-flight-routing-strategy-direct-connecting-and-positioning)
3. [Connecting Flight Implementation](#3-connecting-flight-implementation)
4. [Partner Award Routing (Surcharge Avoidance)](#4-partner-award-routing-surcharge-avoidance)
5. [Points Transfer Decision Engine](#5-points-transfer-decision-engine)
6. [Credit Card to Airline/Hotel Transfer Matrix](#6-credit-card-to-airlinehotel-transfer-matrix)
7. [ILP Optimization Algorithm](#7-ilp-optimization-algorithm)
8. [Implementation Phases](#8-implementation-phases)
9. [Data Models & API Schemas](#9-data-models--api-schemas)
10. [Complete Example: Multi-Segment Trip](#10-complete-example-multi-segment-trip)

---

## 1. Core Optimization Philosophy: OOP vs CPP

### 1.1 Why OOP Matters More Than CPP

| Traditional CPP Approach | Our OOP Approach |
|--------------------------|------------------|
| Maximize cents-per-point (CPP) value | Minimize total cash paid |
| Skip redemptions below 1.0¢ CPP | Use points if it reduces cash outlay |
| "Save points for better use" | Use points strategically now |
| Optimize per-segment | Optimize entire trip holistically |
| May result in high cash spend | Minimizes actual dollars spent |

### 1.2 OOP Formula

```
Out-of-Pocket = Σ (cash_fares) + Σ (award_surcharges)

Goal: Minimize OOP subject to:
- Points balance constraints
- Transfer partner availability
- Award seat availability
```

### 1.3 Impact Example

**Scenario:** 200K Chase UR, 150K Amex MR | Trip: NYC → Tokyo → NYC

| Approach | Flight 1 | Flight 2 | Total OOP |
|----------|----------|----------|-----------|
| **CPP (1.5¢ min)** | Pay cash $1,200 (award CPP=1.2¢) | Award $150 surcharge | **$1,350** |
| **OOP** | Award $80 surcharge | Award $150 surcharge | **$230** |

**Savings: $1,120 (83% reduction)**

---

## 2. Flight Routing Strategy: Direct, Connecting, and Positioning

### 2.1 Routing Hierarchy

The system evaluates flights in this priority order:

```
1. DIRECT FLIGHTS
   ├── Award with low surcharge (<$100)
   ├── Award with moderate surcharge ($100-$200)
   ├── Cash fare (if cheaper than surcharge)
   └── Award with high surcharge (>$200) - penalized

2. CONNECTING FLIGHTS (1-stop)
   ├── Single-carrier connection (same airline, single award)
   ├── Alliance connection (partner programs, may need 2 awards)
   ├── Self-connecting (separate tickets - riskier)
   └── Positioning + long-haul (fly to hub, then destination)

3. MULTI-STOP ITINERARIES (2+ stops)
   └── Rare; only when significant savings or no alternatives
```

### 2.2 When Connecting Flights Win

| Scenario | Direct Option | Connecting Option | Winner |
|----------|--------------|-------------------|--------|
| NYC → Tokyo | UA direct: 70K + $50 | UA via SFO: 35K + $30 | **Connect** (fewer points) |
| NYC → Paris | BA direct: 50K + $600 | AA via DUB: 30K + $50 | **Connect** (much lower surcharge) |
| ITH → London | No direct | ITH→JFK (bus) + JFK→LHR (BA) | **Connect** (only option) |
| LAX → Sydney | QF direct: 80K + $400 | AA via DFW: 70K + $100 | **Connect** (lower OOP) |

### 2.3 Hub Connection Strategy

**Major International Hubs with Good Award Availability:**

| Region | Primary Hubs | Best For |
|--------|--------------|----------|
| US East | JFK, EWR, IAD, MIA | Europe, Middle East, South America |
| US West | LAX, SFO, SEA | Asia, Pacific, Australia |
| US Central | ORD, DFW | Everywhere (major connecting hubs) |
| Europe | LHR, CDG, FRA, AMS | Intra-Europe, Africa, Middle East |
| Asia | HKG, SIN, NRT, ICN | Intra-Asia, Australia |
| Middle East | DXB, DOH, AUH | Africa, South Asia, Australia |

---

## 3. Connecting Flight Implementation

### 3.1 Data Sources for Connecting Flights

```python
# AwardTool returns connecting flights in fare.products[] array
{
    "fare": {
        "products": [
            {
                "origin": "JFK",
                "destination": "DOH",  # Connection city
                "flight_number": "QR702",
                "travel_minutes": 750,
                "layover_time": 180  # 3 hours
            },
            {
                "origin": "DOH",
                "destination": "SIN",  # Final destination
                "flight_number": "QR942",
                "travel_minutes": 480
            }
        ],
        "travel_minutes_total": 1410
    },
    "award_points": 70000,
    "surcharge": 85.60,
    "program_code": "QR"
}
```

### 3.2 Flight Edge Construction

**Location:** `backend/src/handlers/flights.py`

```python
def extract_flight_edges(awardtool_response, serp_response):
    """
    Extract all flight edges including:
    1. Direct flights (single product)
    2. Connecting flights (multiple products = single itinerary)
    3. Individual legs for ground connection analysis
    """
    edges = {}
    
    for item in awardtool_response.get("data", []):
        products = item.get("fare", {}).get("products", [])
        
        if len(products) == 1:
            # Direct flight
            edge = create_direct_edge(products[0], item)
            edges[edge.key] = edge
        else:
            # Connecting flight (single award, multiple legs)
            edge = create_connecting_edge(products, item)
            edges[edge.key] = edge
            
            # Also store individual legs for hybrid routing
            for product in products:
                leg_edge = create_leg_edge(product, item)
                edges[leg_edge.key] = leg_edge
    
    return edges
```

### 3.3 Connection Types

| Type | Description | Points Cost | Booking |
|------|-------------|-------------|---------|
| **Single Award Connection** | Same airline, 1 award for entire trip | Single price | Book on airline.com |
| **Partner Award Connection** | Book via partner (e.g., AA booking QR flight) | Partner price | Book via partner |
| **Self-Connect** | Two separate tickets (not protected) | Sum of segments | Book separately |
| **Positioning + Award** | Cheap flight to hub, then award | Position + Award | Two bookings |

### 3.4 Self-Connection Risk Assessment

```python
def assess_self_connection_risk(
    leg1_arrival: datetime,
    leg2_departure: datetime,
    connection_airport: str,
    is_international: bool
) -> Dict[str, Any]:
    """
    Assess risk of missing a self-connected flight.
    """
    buffer_minutes = (leg2_departure - leg1_arrival).total_seconds() / 60
    
    # Minimum connection times (minutes)
    MIN_DOMESTIC = 60
    MIN_INTL_SAME_TERMINAL = 90
    MIN_INTL_DIFF_TERMINAL = 150
    MIN_INTL_VISA_REQUIRED = 180
    
    min_required = MIN_INTL_DIFF_TERMINAL if is_international else MIN_DOMESTIC
    
    # Risk assessment
    if buffer_minutes < min_required:
        risk_level = "HIGH"
        recommendation = "Avoid - insufficient connection time"
    elif buffer_minutes < min_required * 1.5:
        risk_level = "MEDIUM"
        recommendation = "Proceed with caution - tight connection"
    else:
        risk_level = "LOW"
        recommendation = "Acceptable connection time"
    
    return {
        "buffer_minutes": buffer_minutes,
        "minimum_required": min_required,
        "risk_level": risk_level,
        "recommendation": recommendation,
        "connection_airport": connection_airport,
    }
```

### 3.5 Small Airport Hub Fallback

**Location:** `backend/src/services/itinerary_service.py`

```python
SMALL_AIRPORT_NEARBY_HUBS: Dict[str, List[str]] = {
    # Northeast US
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
    "ACY": ["PHL", "EWR"],                         # Atlantic City
    "HPN": ["JFK", "EWR", "LGA"],                  # Westchester
    
    # Southeast US
    "AVL": ["CLT", "ATL"],                         # Asheville
    "CHS": ["ATL", "CLT", "MIA"],                  # Charleston
    
    # Midwest US
    "FWA": ["ORD", "DTW", "IND"],                  # Fort Wayne
    "SBN": ["ORD", "DTW"],                         # South Bend
    
    # West US
    "SBA": ["LAX", "SFO"],                         # Santa Barbara
    "SMF": ["SFO", "LAX"],                         # Sacramento
}

async def get_flights_with_hub_fallback(origin, destination, ...):
    """
    Try direct flights first, then hub connections if needed.
    """
    # Try direct
    edges = await get_flights_award_first(origin, destination, ...)
    
    if not edges and origin in SMALL_AIRPORT_NEARBY_HUBS:
        for hub in SMALL_AIRPORT_NEARBY_HUBS[origin]:
            # Get ground transport to hub
            ground_edge = await get_ground_transport(origin, hub, date)
            
            # Get flights from hub
            hub_edges = await get_flights_award_first(hub, destination, ...)
            
            if hub_edges:
                # Combine ground + flight options
                edges.update(hub_edges)
                edges[f"{origin}_{hub}_ground"] = ground_edge
                break
    
    return edges
```

---

## 4. Partner Award Routing (Surcharge Avoidance)

### 4.1 The Surcharge Problem

Some airlines charge excessive fuel surcharges on award tickets:

| Airline | Typical Surcharge | Partner Alternative |
|---------|-------------------|---------------------|
| British Airways | $400-800+ | Book via AA or AS ($50) |
| Lufthansa | $300-600 | Book via United ($30) |
| Singapore | $200-400 | Book via United or Aeroplan ($30) |
| Air France/KLM | $200-350 | Book via Delta ($50) |
| Qantas | $300-500 | Book via AA ($100) |

### 4.2 Alliance Partnerships

```python
ALLIANCE_PARTNERS: Dict[str, List[str]] = {
    # Star Alliance - book each other's flights
    "UA": ["AC", "LH", "TK", "SQ", "NH", "AV", "LX"],  # United partners
    "LH": ["UA", "AC", "TK", "SQ", "NH", "AV", "LX"],  # Lufthansa partners
    "SQ": ["UA", "AC", "LH", "TK", "NH", "AV", "LX"],  # Singapore partners
    
    # Oneworld - book each other's flights
    "AA": ["BA", "IB", "QF", "CX", "QR", "AS"],  # American partners
    "BA": ["AA", "IB", "QF", "CX", "QR", "AS"],  # British Airways partners
    "QF": ["AA", "BA", "IB", "CX", "QR", "AS"],  # Qantas partners
    
    # SkyTeam - book each other's flights
    "DL": ["AF", "KL", "VS", "KE"],  # Delta partners
    "AF": ["DL", "KL", "VS", "KE"],  # Air France partners
}
```

### 4.3 Partner Surcharge Overrides

```python
# When booking via partner, surcharges are often much lower
PARTNER_SURCHARGE_OVERRIDES: Dict[Tuple[str, str], float] = {
    # (Operating Carrier, Booking Program) -> Typical Surcharge
    ("BA", "AA"): 50,    # BA metal via American - LOW surcharges!
    ("BA", "AS"): 50,    # BA metal via Alaska - LOW surcharges!
    ("LH", "UA"): 30,    # Lufthansa via United
    ("LX", "UA"): 30,    # Swiss via United
    ("AF", "DL"): 50,    # Air France via Delta
    ("KL", "DL"): 50,    # KLM via Delta
    ("SQ", "UA"): 30,    # Singapore via United (NO fuel surcharges!)
    ("SQ", "AC"): 30,    # Singapore via Aeroplan
    ("QF", "AA"): 100,   # Qantas via American (much lower)
}

def get_best_booking_program(operating_carrier: str, available_programs: List[str]) -> str:
    """
    Find the best program to book a flight to minimize surcharges.
    """
    best_program = operating_carrier
    best_surcharge = float('inf')
    
    for program in available_programs:
        surcharge = PARTNER_SURCHARGE_OVERRIDES.get(
            (operating_carrier, program),
            # Default: own program surcharge (usually higher)
            TYPICAL_SURCHARGES.get(operating_carrier, 100)
        )
        
        if surcharge < best_surcharge:
            best_surcharge = surcharge
            best_program = program
    
    return best_program, best_surcharge
```

### 4.4 Partner Award Search Strategy

```python
async def search_with_partner_alternatives(
    origin: str,
    destination: str,
    date: str,
    user_programs: List[str]  # Programs user has points in or can transfer to
) -> List[FlightOption]:
    """
    Search for flights and find the best booking program for each.
    """
    options = []
    
    # 1. Get all available flights (any carrier)
    flights = await get_all_flights(origin, destination, date)
    
    for flight in flights:
        operating_carrier = flight.operating_carrier
        
        # 2. Find programs that can book this flight
        bookable_programs = [operating_carrier]  # Own program always works
        
        # Add alliance partners
        for partner in ALLIANCE_PARTNERS.get(operating_carrier, []):
            if partner in user_programs:
                bookable_programs.append(partner)
        
        # 3. Find best program (lowest surcharge)
        for program in bookable_programs:
            surcharge = get_partner_surcharge(operating_carrier, program)
            points_cost = get_award_price(operating_carrier, program, flight)
            
            options.append(FlightOption(
                flight=flight,
                booking_program=program,
                points_cost=points_cost,
                surcharge=surcharge,
                out_of_pocket=surcharge,  # Award OOP = surcharge only
            ))
    
    # 4. Sort by OOP (surcharge)
    return sorted(options, key=lambda x: x.out_of_pocket)
```

---

## 5. Points Transfer Decision Engine

### 5.1 Transfer Decision Algorithm

```python
def decide_optimal_transfer(
    flight_options: List[FlightOption],
    user_balances: Dict[str, int],  # {"chase": 150000, "amex": 200000, "UA": 25000}
    transfer_graph: Dict[str, Dict[str, float]]
) -> TransferDecision:
    """
    Decide the optimal way to pay for flights.
    
    Priority:
    1. Use native airline miles if sufficient (no transfer needed)
    2. Transfer from bank with best ratio and instant transfer
    3. Consider multiple bank transfers if single source insufficient
    """
    
    for option in sorted(flight_options, key=lambda x: x.out_of_pocket):
        program = option.booking_program
        points_needed = option.points_cost
        
        # Check 1: Native miles available?
        native_balance = user_balances.get(program, 0)
        if native_balance >= points_needed:
            return TransferDecision(
                type="native",
                program=program,
                points_used=points_needed,
                transfer_from=None,
                transfer_amount=0,
                out_of_pocket=option.surcharge
            )
        
        # Check 2: Bank transfer available?
        for bank, bank_balance in user_balances.items():
            if bank.islower():  # Banks are lowercase
                if program in transfer_graph.get(bank, {}):
                    ratio = transfer_graph[bank][program]
                    bank_points_needed = int(points_needed / ratio)
                    
                    if bank_balance >= bank_points_needed:
                        return TransferDecision(
                            type="transfer",
                            program=program,
                            points_used=points_needed,
                            transfer_from=bank,
                            transfer_amount=bank_points_needed,
                            out_of_pocket=option.surcharge
                        )
        
        # Check 3: Combine native + transfer?
        shortfall = points_needed - native_balance
        for bank, bank_balance in user_balances.items():
            if bank.islower() and program in transfer_graph.get(bank, {}):
                ratio = transfer_graph[bank][program]
                bank_points_needed = int(shortfall / ratio)
                
                if bank_balance >= bank_points_needed:
                    return TransferDecision(
                        type="hybrid",
                        program=program,
                        points_used=points_needed,
                        native_used=native_balance,
                        transfer_from=bank,
                        transfer_amount=bank_points_needed,
                        out_of_pocket=option.surcharge
                    )
    
    # Fallback: Pay cash
    return TransferDecision(type="cash", out_of_pocket=cheapest_cash_option.price)
```

### 5.2 Multi-Segment Transfer Consolidation

```python
def consolidate_transfers(
    segment_decisions: List[TransferDecision]
) -> List[TransferInstruction]:
    """
    Combine multiple transfer decisions into consolidated instructions.
    
    Example:
        Segment 1: Chase → UA 30,000
        Segment 2: Chase → UA 25,000
        Result: Chase → UA 55,000 (single transfer)
    """
    consolidated = {}
    
    for decision in segment_decisions:
        if decision.type in ["transfer", "hybrid"]:
            key = (decision.transfer_from, decision.program)
            
            if key in consolidated:
                consolidated[key]["amount"] += decision.transfer_amount
                consolidated[key]["for_segments"].append(decision.segment_id)
            else:
                consolidated[key] = {
                    "from_bank": decision.transfer_from,
                    "to_program": decision.program,
                    "amount": decision.transfer_amount,
                    "for_segments": [decision.segment_id]
                }
    
    return [
        TransferInstruction(**data)
        for data in consolidated.values()
    ]
```

### 5.3 Transfer Time Awareness

```python
TRANSFER_TIMES: Dict[str, Dict[str, Any]] = {
    "chase": {
        "time_display": "Instant",
        "hours": 0,
        "safe_for_travel_in": 0,  # days
    },
    "amex": {
        "time_display": "1-2 business days",
        "hours": 48,
        "safe_for_travel_in": 3,  # days
    },
    "citi": {
        "time_display": "Instant to 24 hours",
        "hours": 24,
        "safe_for_travel_in": 1,
    },
    "capitalone": {
        "time_display": "Instant to 2 days",
        "hours": 48,
        "safe_for_travel_in": 3,
    },
    "bilt": {
        "time_display": "Instant",
        "hours": 0,
        "safe_for_travel_in": 0,
    },
}

def filter_by_transfer_time(
    options: List[TransferDecision],
    days_until_travel: int
) -> List[TransferDecision]:
    """
    Filter out transfer options that won't complete in time.
    """
    return [
        opt for opt in options
        if (opt.type == "native" or
            TRANSFER_TIMES[opt.transfer_from]["safe_for_travel_in"] <= days_until_travel)
    ]
```

---

## 6. Credit Card to Airline/Hotel Transfer Matrix

### 6.1 Complete Bank → Airline Transfer Table

| Airline | Program | Chase | Amex | Citi | Cap One | Bilt |
|---------|---------|-------|------|------|---------|------|
| **United** | MileagePlus | ✓ 1:1 | - | - | - | ✓ 1:1 |
| **American** | AAdvantage | - | - | ✓ 1:1 | - | ✓ 1:1 |
| **Delta** | SkyMiles | - | ✓ 1:1 | - | - | - |
| **Alaska** | Mileage Plan | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:1 | ✓ 1:1 |
| **JetBlue** | TrueBlue | ✓ 1:1 | ✓ 1:0.8 | ✓ 1:1 | - | - |
| **Southwest** | Rapid Rewards | ✓ 1:1 | - | - | - | ✓ 1:1 |
| **Air France/KLM** | Flying Blue | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| **British Airways** | Avios | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:0.75 | ✓ 1:1 |
| **Singapore** | KrisFlyer | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | - |
| **Emirates** | Skywards | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| **Virgin Atlantic** | Flying Club | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| **Turkish** | Miles&Smiles | - | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| **ANA** | Mileage Club | - | ✓ 1:1 | - | - | - |
| **Cathay** | Asia Miles | - | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| **Avianca** | LifeMiles | - | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |

### 6.2 Complete Bank → Hotel Transfer Table

| Hotel | Program | Chase | Amex | Cap One | Bilt |
|-------|---------|-------|------|---------|------|
| **Hyatt** | World of Hyatt | ✓ 1:1 | - | - | ✓ 1:1 |
| **Marriott** | Bonvoy | ✓ 1:1 | ✓ 1:1 | - | - |
| **Hilton** | Honors | - | ✓ **1:2** | - | - |
| **IHG** | Rewards | ✓ 1:1 | - | - | ✓ 1:1 |
| **Accor** | Live Limitless | - | - | ✓ 1:1 | - |
| **Wyndham** | Rewards | - | - | ✓ 1:1 | - |

### 6.3 Credit Card Recommendations by Travel Goal

| Goal | Best Cards | Why |
|------|-----------|-----|
| **US Domestic (United hubs)** | Chase Sapphire Reserve | 1:1 to United, instant transfers |
| **US Domestic (AA hubs)** | Citi Premier or Bilt | 1:1 to American |
| **Transatlantic (Economy)** | Chase or Amex | Air France, Virgin Atlantic partners |
| **Transatlantic (Business)** | Amex Platinum | ANA, Delta One access |
| **Asia (Japan)** | Amex Platinum | ANA 1:1, JAL via LifeMiles |
| **Asia (Everywhere)** | Citi Premier | Singapore, Cathay, Thai |
| **Middle East** | Any premium | Most transfer 1:1 to Emirates, Qatar |
| **Hotels (Luxury)** | Chase Sapphire Reserve | Hyatt 1:1 (best CPP) |
| **Hotels (Volume)** | Amex Gold | Hilton 1:2 (double points!) |

### 6.4 Transfer Portal URLs

```python
BANK_TRANSFER_PORTALS = {
    "chase": {
        "name": "Chase Ultimate Rewards",
        "url": "https://ultimaterewardspoints.chase.com",
        "cards": ["Sapphire Reserve", "Sapphire Preferred", "Ink Preferred", "Ink Cash", "Freedom Unlimited"],
    },
    "amex": {
        "name": "American Express Membership Rewards",
        "url": "https://global.americanexpress.com/rewards",
        "cards": ["Platinum", "Gold", "Green", "Business Platinum", "Business Gold"],
    },
    "citi": {
        "name": "Citi ThankYou Rewards",
        "url": "https://thankyou.citi.com",
        "cards": ["Premier", "Prestige", "Double Cash", "Custom Cash"],
    },
    "capitalone": {
        "name": "Capital One Miles",
        "url": "https://www.capitalone.com/credit-cards/benefits/travel/",
        "cards": ["Venture X", "Venture", "Spark Miles"],
    },
    "bilt": {
        "name": "Bilt Rewards",
        "url": "https://www.biltrewards.com",
        "cards": ["Bilt Mastercard"],
    },
}
```

---

## 7. ILP Optimization Algorithm

### 7.1 Mathematical Formulation

**Objective Function (Minimize OOP):**

```
Minimize:
    Σᵢ (pay_cash[i] × cash_cost[i]) +
    Σᵢ,ₚ (use_points[i,p] × surcharge[i,p])
```

**Decision Variables:**

| Variable | Type | Description |
|----------|------|-------------|
| `pay_cash[i]` | Binary | 1 if item i paid with cash |
| `use_points[i,p]` | Binary | 1 if item i paid via program p |
| `transfer[b,p]` | Integer | Points transferred from bank b to program p |
| `use_native[i,p]` | Binary | 1 if using existing airline miles for item i |

**Constraints:**

```
1. Payment Constraint (each item paid exactly once):
   ∀i: pay_cash[i] + Σₚ use_points[i,p] = 1

2. Points Balance (don't exceed available):
   ∀p: Σᵢ (use_points[i,p] × points_req[i,p]) ≤ balance[p] + Σᵦ transfer[b,p] × ratio[b,p]

3. Transfer Limit (don't transfer more than balance):
   ∀b: Σₚ transfer[b,p] ≤ balance[b]

4. Transfer Validity (only to valid partners):
   ∀b,p: transfer[b,p] = 0 if (b,p) not in transfer_graph

5. Award Availability (respect seat limits):
   ∀i,p: use_points[i,p] ≤ award_available[i,p]
```

### 7.2 Objective Function Weights

```python
# Weights for multi-objective optimization
W_CASH = 1000          # Penalize cash spending
W_SURCHARGE = 1000     # Penalize surcharges (same as cash)
W_TIME = 1             # Minor penalty for travel time
W_CONNECTIONS = 50     # Minor penalty per connection
W_HIGH_SURCHARGE = 500 # Extra penalty for surcharge > $200
```

### 7.3 Implementation

```python
def minimize_trip_oop(
    items: List[BookableItem],  # Flights + Hotels
    user_balances: Dict[str, int],
    transfer_graph: Dict[str, Dict[str, float]],
) -> OptimizationResult:
    """
    Solve ILP to minimize total out-of-pocket.
    """
    import pulp as pl
    
    prob = pl.LpProblem("MinimizeOOP", pl.LpMinimize)
    
    # Identify banks vs programs
    banks = [k for k in user_balances if k.islower()]
    programs = set()
    for item in items:
        for opt in item.points_options:
            programs.add(opt.program)
    
    # Variables
    pay_cash = {
        item.id: pl.LpVariable(f"cash_{item.id}", cat="Binary")
        for item in items
    }
    
    use_points = {
        (item.id, opt.program): pl.LpVariable(
            f"pts_{item.id}_{opt.program}", cat="Binary"
        )
        for item in items
        for opt in item.points_options
    }
    
    transfer = {
        (bank, prog): pl.LpVariable(
            f"xfer_{bank}_{prog}", lowBound=0, cat="Integer"
        )
        for bank in banks
        for prog in programs
        if prog in transfer_graph.get(bank, {})
    }
    
    # Objective: Minimize OOP
    prob += (
        W_CASH * pl.lpSum(pay_cash[i.id] * i.cash_cost for i in items) +
        W_SURCHARGE * pl.lpSum(
            use_points[(i.id, o.program)] * o.surcharge
            for i in items for o in i.points_options
        ) +
        W_HIGH_SURCHARGE * pl.lpSum(
            use_points[(i.id, o.program)] * max(0, o.surcharge - 200)
            for i in items for o in i.points_options
        )
    )
    
    # Constraint 1: Pay each item exactly once
    for item in items:
        prob += (
            pay_cash[item.id] +
            pl.lpSum(use_points[(item.id, o.program)] for o in item.points_options)
            == 1
        )
    
    # Constraint 2: Points balance
    for prog in programs:
        points_used = pl.lpSum(
            use_points[(i.id, o.program)] * o.points_required
            for i in items for o in i.points_options
            if o.program == prog
        )
        native_balance = user_balances.get(prog, 0)
        transferred_in = pl.lpSum(
            transfer[(b, prog)] * transfer_graph[b][prog]
            for b in banks if (b, prog) in transfer
        )
        prob += points_used <= native_balance + transferred_in
    
    # Constraint 3: Transfer limits
    for bank in banks:
        prob += pl.lpSum(
            transfer[(bank, p)] for p in programs if (bank, p) in transfer
        ) <= user_balances[bank]
    
    # Solve
    prob.solve(pl.PULP_CBC_CMD(msg=False, timeLimit=30))
    
    return extract_solution(prob, items, pay_cash, use_points, transfer)
```

---

## 8. Implementation Phases

### Phase 1: Connecting Flight Support

| Task | Description | File | Priority |
|------|-------------|------|----------|
| 1.1 | Parse multi-leg flights from AwardTool | `flights.py` | Critical |
| 1.2 | Extract individual legs for hybrid routing | `flights.py` | High |
| 1.3 | Implement self-connection risk assessment | `route_optimizer.py` | Medium |
| 1.4 | Add hub fallback for small airports | `itinerary_service.py` | High |
| 1.5 | Support positioning flight analysis | `route_optimizer.py` | Medium |

### Phase 2: Partner Award Routing

| Task | Description | File | Priority |
|------|-------------|------|----------|
| 2.1 | Define alliance partnerships | `oop_optimizer.py` | Critical |
| 2.2 | Implement partner surcharge overrides | `oop_optimizer.py` | Critical |
| 2.3 | Search for partner award alternatives | `flights.py` | High |
| 2.4 | Rank options by OOP (surcharge) | `ilp_adapter.py` | High |

### Phase 3: Transfer Optimization

| Task | Description | File | Priority |
|------|-------------|------|----------|
| 3.1 | Implement transfer decision algorithm | `transfer_strategy.py` | Critical |
| 3.2 | Add transfer time filtering | `transfer_strategy.py` | High |
| 3.3 | Consolidate multi-segment transfers | `transfer_strategy.py` | Medium |
| 3.4 | Generate step-by-step instructions | `transfer_strategy.py` | High |

### Phase 4: ILP Enhancement

| Task | Description | File | Priority |
|------|-------------|------|----------|
| 4.1 | Add OOP optimization mode | `planTrip.py` | Critical |
| 4.2 | Include high-surcharge penalty | `planTrip.py` | High |
| 4.3 | Support hybrid (native + transfer) | `planTrip.py` | Medium |
| 4.4 | Add connection penalty term | `planTrip.py` | Low |

### Phase 5: API & Frontend

| Task | Description | File | Priority |
|------|-------------|------|----------|
| 5.1 | Create `/api/trip/optimize-oop` endpoint | `app.py` | Critical |
| 5.2 | Return detailed transfer instructions | `app.py` | High |
| 5.3 | Create TransferStrategy UI component | `frontend/` | High |
| 5.4 | Show connecting flight details | `frontend/` | Medium |

---

## 9. Data Models & API Schemas

### 9.1 Flight Edge Model

```python
@dataclass
class FlightEdge:
    """Represents a bookable flight (direct or connecting)."""
    
    # Route info
    origin: str                    # "JFK"
    destination: str               # "NRT"
    is_direct: bool                # True if nonstop
    
    # Connection info (if not direct)
    segments: List[FlightSegment]  # Individual legs
    connection_airports: List[str] # ["ORD"]
    total_travel_minutes: int
    layover_minutes: List[int]     # [120] for 2hr layover
    
    # Pricing - Cash
    cash_cost: Optional[float]
    
    # Pricing - Award
    points_options: List[PointsOption]
    
    # Metadata
    operating_carriers: List[str]  # ["UA", "NH"]
    departure_time: str
    arrival_time: str

@dataclass
class FlightSegment:
    """Single flight leg."""
    origin: str
    destination: str
    flight_number: str
    operating_carrier: str
    departure_time: str
    arrival_time: str
    duration_minutes: int

@dataclass
class PointsOption:
    """Award booking option."""
    program: str                   # "UA"
    program_name: str              # "United MileagePlus"
    points_required: int           # 70000
    surcharge: float               # 85.60
    cabin: str                     # "economy"
    
    # Transfer info
    transfer_options: List[TransferPath]

@dataclass
class TransferPath:
    """How to fund this award."""
    bank: str                      # "chase"
    bank_name: str                 # "Chase Ultimate Rewards"
    bank_points_needed: int        # 70000
    ratio: float                   # 1.0
    transfer_time: str             # "instant"
```

### 9.2 Optimization Result Model

```python
@dataclass
class OptimizationResult:
    """Complete optimization output."""
    
    status: str                    # "Optimal", "Feasible", "Infeasible"
    
    # Cost summary
    total_out_of_pocket: float
    total_points_used: int
    all_cash_cost: float
    savings: float
    savings_percentage: float
    
    # Detailed breakdown
    flight_payments: List[PaymentInstruction]
    hotel_payments: List[PaymentInstruction]
    transfer_instructions: List[TransferInstruction]
    
    # Points usage by program
    points_by_program: Dict[str, int]
    
    # Remaining balances
    remaining_balances: Dict[str, int]

@dataclass
class PaymentInstruction:
    """How to pay for one item."""
    item_id: str
    item_type: str                 # "flight" or "hotel"
    description: str               # "JFK → NRT (via ORD) on United"
    
    # Route details (for flights)
    origin: Optional[str]
    destination: Optional[str]
    is_connecting: bool
    connection_cities: List[str]
    
    # Payment
    payment_type: str              # "cash" or "points"
    cash_paid: float
    points_used: Optional[int]
    program_used: Optional[str]
    
    # Booking info
    booking_url: Optional[str]
    booking_instructions: List[str]

@dataclass
class TransferInstruction:
    """Step-by-step transfer instruction."""
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    
    points_to_transfer: int
    transfer_ratio: str            # "1:1"
    resulting_points: int
    
    transfer_time: str
    portal_url: str
    
    steps: List[str]
    for_items: List[str]           # Which bookings this covers
    
    # Timing warning
    warning: Optional[str]         # "Transfer may take 2 days"
```

### 9.3 API Response Schema

```json
{
  "status": "Optimal",
  "summary": {
    "total_out_of_pocket": 315.00,
    "all_cash_cost": 4200.00,
    "savings": 3885.00,
    "savings_percentage": 92.5,
    "total_points_used": 185000
  },
  "transfers": [
    {
      "from_bank": "chase",
      "from_bank_name": "Chase Ultimate Rewards",
      "to_program": "UA",
      "to_program_name": "United MileagePlus",
      "points_to_transfer": 70000,
      "transfer_ratio": "1:1",
      "resulting_points": 70000,
      "transfer_time": "instant",
      "portal_url": "https://ultimaterewardspoints.chase.com",
      "steps": [
        "1. Log in to Chase Ultimate Rewards",
        "2. Click 'Transfer Points' → 'Travel Partners'",
        "3. Select 'United MileagePlus'",
        "4. Enter your MileagePlus number",
        "5. Transfer 70,000 points",
        "6. Confirm (transfers instantly)"
      ],
      "for_items": ["flight_jfk_nrt"]
    }
  ],
  "payments": [
    {
      "item_id": "flight_jfk_nrt",
      "item_type": "flight",
      "description": "JFK → NRT via ORD on United",
      "is_connecting": true,
      "connection_cities": ["ORD"],
      "segments": [
        {"origin": "JFK", "destination": "ORD", "flight": "UA123", "duration": 150},
        {"origin": "ORD", "destination": "NRT", "flight": "UA881", "duration": 780}
      ],
      "payment_type": "points",
      "cash_paid": 85.60,
      "points_used": 70000,
      "program_used": "United MileagePlus",
      "booking_url": "https://www.united.com/...",
      "booking_instructions": [
        "1. Go to united.com and log in",
        "2. Search JFK → NRT on your dates",
        "3. Select 'Book with miles'",
        "4. Choose the 70,000 mile option",
        "5. Complete booking (pay $85.60 taxes)"
      ]
    }
  ],
  "points_by_program": {
    "United MileagePlus": 70000,
    "Hilton Honors": 115000
  },
  "remaining_balances": {
    "chase": 80000,
    "amex": 85000
  }
}
```

---

## 10. Complete Example: Multi-Segment Trip

### Scenario

**User Points:**
- Chase Ultimate Rewards: 150,000
- Amex Membership Rewards: 200,000
- United MileagePlus: 25,000 (native airline miles)
- Hilton Honors: 50,000 (native hotel points)

**Trip:** New York → Tokyo → Hong Kong → New York (14 days)

### Step 1: Search All Flight Options

| Route | Direct Option | Connecting Option | Partner Option |
|-------|--------------|-------------------|----------------|
| JFK → NRT | ANA: 55K + $200 | UA via ORD: 70K + $85 | - |
| NRT → HKG | CX: 20K + $50 | JL: 15K + $30 | AA booking CX: 20K + $30 |
| HKG → JFK | CX: 70K + $150 | AA via DFW: 65K + $80 | CX via UA: blocked |

### Step 2: OOP Analysis

| Route | Best OOP Option | Points | Surcharge | Notes |
|-------|----------------|--------|-----------|-------|
| JFK → NRT | UA connecting | 70,000 | $85 | Lower surcharge than ANA direct |
| NRT → HKG | JL direct | 15,000 | $30 | Lowest points, low surcharge |
| HKG → JFK | AA connecting | 65,000 | $80 | Via DFW, lower than CX direct |
| Tokyo Hotel | Hyatt (5 nights) | 100,000 | $50 | Chase → Hyatt 1:1 |
| HK Hotel | Hilton (4 nights) | 160,000 | $40 | Amex → Hilton 1:2 (80K MR) |

### Step 3: Transfer Plan

```
═══════════════════════════════════════════════════════════════════
                    OPTIMIZED TRANSFER PLAN
═══════════════════════════════════════════════════════════════════

FLIGHT TRANSFERS:
─────────────────

① CHASE → UNITED MILEAGEPLUS
   Transfer: 45,000 points (you have 25K native, need 70K total)
   Time: Instant
   For: JFK → NRT via ORD flight
   
② AMEX → JAPAN AIRLINES (MILEAGE BANK)
   Transfer: 15,000 points
   Time: 1-2 business days
   For: NRT → HKG flight
   
③ CITI → AMERICAN AADVANTAGE (or use existing AA miles)
   Transfer: 65,000 points
   Time: Instant
   For: HKG → JFK via DFW flight

HOTEL TRANSFERS:
────────────────

④ CHASE → WORLD OF HYATT
   Transfer: 100,000 points
   Time: Instant
   For: Tokyo hotel (5 nights)

⑤ AMEX → HILTON HONORS
   Transfer: 80,000 points → 160,000 Hilton (2x bonus!)
   Time: 1-2 business days
   For: Hong Kong hotel (4 nights)

═══════════════════════════════════════════════════════════════════
                        COST SUMMARY
═══════════════════════════════════════════════════════════════════

                    Points     Cash (OOP)
JFK → NRT (UA)      70,000        $85
NRT → HKG (JL)      15,000        $30
HKG → JFK (AA)      65,000        $80
Tokyo Hyatt        100,000        $50
HK Hilton          160,000        $40
────────────────────────────────────────
TOTAL              410,000       $285

vs. ALL CASH:                   $5,800
SAVINGS:                        $5,515 (95%!)

═══════════════════════════════════════════════════════════════════
                   BOOKING INSTRUCTIONS
═══════════════════════════════════════════════════════════════════

STEP 1: TRANSFER POINTS (do this FIRST, at least 3 days before booking)
• Chase → United: 45,000 points [instant]
• Chase → Hyatt: 100,000 points [instant]
• Amex → JAL: 15,000 points [wait 2 days]
• Amex → Hilton: 80,000 points [wait 2 days]

STEP 2: BOOK FLIGHTS (after transfers complete)
✈ JFK → NRT: Book at united.com using 70,000 miles + $85
✈ NRT → HKG: Book at jal.com using 15,000 miles + $30
✈ HKG → JFK: Book at aa.com using 65,000 miles + $80

STEP 3: BOOK HOTELS
🏨 Tokyo: Book at hyatt.com using 100,000 points + $50
🏨 Hong Kong: Book at hilton.com using 160,000 points + $40

═══════════════════════════════════════════════════════════════════
```

---

## Appendix A: CPP Thresholds by Program

| Program | Min CPP Threshold | Typical Surcharge | Notes |
|---------|-------------------|-------------------|-------|
| United (UA) | 1.0¢ | Low ($5-50) | Dynamic pricing |
| American (AA) | 1.0¢ | Low ($5-50) | Dynamic pricing |
| Delta (DL) | 1.0¢ | Low ($5-50) | Often poor value |
| Alaska (AS) | 1.1¢ | Low ($5-30) | Great partners |
| JetBlue (B6) | 0.9¢ | Low ($5-20) | Often poor value |
| British Airways (BA) | 1.8¢ | **HIGH** ($400-800) | Use partners! |
| Lufthansa (LH) | 1.6¢ | **HIGH** ($300-600) | Use United instead |
| Singapore (SQ) | 1.5¢ | Medium ($100-300) | Use United/Aeroplan |
| ANA (NH) | 1.5¢ | Medium ($100-200) | Great value |
| Cathay (CX) | 1.3¢ | Medium ($100-200) | Good availability |
| Emirates (EK) | 1.2¢ | Low ($30-100) | Good value |
| Avianca (AV) | 1.4¢ | **NONE** ($0-30) | Excellent value! |
| Virgin Atlantic (VS) | 1.3¢ | Low ($30-100) | Great partners |

---

## Appendix B: Award Sweet Spots by Route

| Route | Best Program | Typical Points | Surcharge | Notes |
|-------|--------------|----------------|-----------|-------|
| US → Europe (Econ) | Air France | 30,000 | $50-100 | Flying Blue promos |
| US → Europe (Biz) | Virgin Atlantic | 50,000 | $50-100 | Book on Air France |
| US → Japan (Econ) | ANA | 45,000-55,000 | $100-200 | Via Amex transfer |
| US → Japan (Biz) | ANA | 75,000-95,000 | $100-200 | Excellent value |
| US → SE Asia | Avianca | 60,000 | $0-30 | LifeMiles on Star Alliance |
| US → Australia | American | 75,000 | $50-150 | Via Qantas |
| US → Middle East | Emirates | 62,500-85,000 | $30-100 | Good availability |
| Intra-Europe | British Airways | 4,000-13,000 | $20-50 | Avios sweet spot |
| Intra-Asia | Cathay | 10,000-25,000 | $30-80 | Asia Miles |

---

*Document Version: 1.0*
*Created: January 2026*
*Focus: Connecting flights, Partner awards, and OOP minimization*
