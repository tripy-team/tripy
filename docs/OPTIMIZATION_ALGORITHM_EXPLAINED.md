# Tripy Optimization Algorithm: How It Works

This document explains how Tripy's optimization algorithm finds the best travel itineraries while maximizing loyalty points value and minimizing user spending.

---

## Table of Contents

1. [Overview: What the Algorithm Does](#overview-what-the-algorithm-does)
2. [The Two-Layer Architecture](#the-two-layer-architecture)
3. [How Airport Constraints Work (Seattle ↔ NYC Example)](#how-airport-constraints-work-seattle--nyc-example)
4. [How Connecting Flights Are Evaluated](#how-connecting-flights-are-evaluated)
5. [The Three Optimization Modes](#the-three-optimization-modes)
6. [How Points Transfers Work](#how-points-transfers-work)
7. [How Tripy Saves Users Money](#how-tripy-saves-users-money)

---

## Overview: What the Algorithm Does

Tripy uses **Mixed Integer Linear Programming (MILP)** to solve a complex optimization problem: given a trip with multiple destinations, multiple flight options, multiple hotel options, and a user's loyalty points across various programs, find the **optimal combination** that either:

1. **Minimizes out-of-pocket cash** (OOP mode)
2. **Maximizes cents-per-point value** (CPP mode)
3. **Balances value, time, and convenience** (Balanced mode)

The solver (PuLP with CBC backend) evaluates thousands of combinations in under a second to find mathematically optimal solutions.

---

## The Two-Layer Architecture

Tripy's optimization happens in **two distinct layers**:

### Layer 1: Search & Airport Expansion (Pre-Optimization)

Before the optimizer runs, the **search layer** handles:

1. **Airport group expansion**: When a user selects "Seattle" or "NYC", the system expands this to all relevant airports:
   - "Seattle" → SEA (Seattle-Tacoma), plus nearby commercial airports
   - "New York City" → JFK, LGA, EWR (Newark)
   
2. **Flight data fetching**: The system searches for flights between **all possible airport pairs**:
   - SEA → JFK, SEA → LGA, SEA → EWR (for outbound)
   - JFK → SEA, LGA → SEA, EWR → SEA (for return)

3. **Award availability lookup**: For each flight, the system fetches:
   - Cash price
   - Award pricing (miles required + taxes/surcharges)
   - Which loyalty programs can book it
   - Transfer partner eligibility

### Layer 2: MILP Optimization (Constraint Enforcement)

The optimizer receives **specific flight/hotel options** (with concrete airport codes) and decides:

1. **Which flight to select** for each leg
2. **How to pay** (cash vs. points)
3. **Which points program** to use (if paying with points)
4. **How many points to transfer** from bank programs

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         USER INPUT                                      │
│   Origin: Seattle (any airport)                                         │
│   Destination: New York City (any airport)                              │
│   Points: 100K Chase, 50K United miles                                  │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   LAYER 1: SEARCH & EXPANSION                           │
│                                                                         │
│   Seattle → [SEA, BFI, PAE]     NYC → [JFK, LGA, EWR]                  │
│                                                                         │
│   Search all combinations:                                              │
│   • SEA → JFK: 15 flights found (various airlines, times, prices)      │
│   • SEA → LGA: 8 flights found                                          │
│   • SEA → EWR: 12 flights found                                         │
│   • ... plus return flights                                             │
│                                                                         │
│   Total: ~70 flight options with cash + award pricing                   │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                   LAYER 2: MILP OPTIMIZATION                            │
│                                                                         │
│   Input: 70 flight options, user's points balances                      │
│                                                                         │
│   Constraints:                                                          │
│   • Select exactly 1 flight per leg                                     │
│   • Payment method per flight (cash OR points)                          │
│   • Points balance limits                                               │
│   • Transfer rules (Chase → United at 1:1, etc.)                       │
│                                                                         │
│   Output: "Book SEA→JFK on United with 35K miles from Chase transfer"  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## How Airport Constraints Work (Seattle ↔ NYC Example)

### Step 1: City-to-Airport Resolution

When a user enters "Seattle" as their departure, the `airport_service.py` and `city_service.py` modules resolve this to actual airports:

```python
# City nickname expansions (from airport_service.py)
CITY_NICKNAME_EXPANSIONS = {
    "SEA": ["SEATTLE"],
    "NYC": ["NEW YORK", "NEWARK"],
    # ...
}
```

The Amadeus API and local airport database are queried to find:
- **Seattle area**: SEA (Seattle-Tacoma International)
- **NYC area**: JFK (Kennedy), LGA (LaGuardia), EWR (Newark)

### Step 2: Flight Search for All Airport Pairs

The search layer queries flight APIs for **every valid airport combination**:

| Leg | Origin Options | Destination Options | Searches Performed |
|-----|---------------|--------------------|--------------------|
| 1 (Outbound) | SEA | JFK, LGA, EWR | 3 searches |
| 2 (Return) | JFK, LGA, EWR | SEA | 3 searches |

Each search returns multiple flight options with different:
- Airlines
- Departure times
- Number of stops
- Cash prices
- Award availability

### Step 3: Optimizer Receives Concrete Options

The optimizer receives a list like:

```python
flights = [
    FlightItineraryEdge(
        leg_id=0,                    # Outbound leg
        origin="SEA",                # Specific airport
        destination="JFK",           # Specific airport
        cash_cost=450.00,
        award_options=[
            AwardOption(program="united", points=35000, surcharge=5.60),
            AwardOption(program="delta", points=42000, surcharge=5.60),
        ],
        total_time_minutes=320,
        num_stops=0,
    ),
    FlightItineraryEdge(
        leg_id=0,
        origin="SEA",
        destination="EWR",           # Different NYC airport
        cash_cost=380.00,
        award_options=[...],
        total_time_minutes=360,
        num_stops=1,
    ),
    # ... more options
]
```

### Step 4: MILP Selection Constraint

The optimizer enforces that **exactly one flight is selected per leg**:

```
Constraint: ∑ x[flight] = 1  for all flights on leg 0
```

Where `x[flight]` is a binary variable (0 or 1) indicating whether that flight is selected.

**Result**: The optimizer chooses the best SEA → (JFK/LGA/EWR) option based on the objective function, automatically selecting the optimal arrival airport.

---

## How Connecting Flights Are Evaluated

The optimizer evaluates connecting flights through **three mechanisms**:

### 1. Pre-Optimization Filtering (Hard Constraints)

Before optimization, the `validators.py` module applies hard filters:

```python
# From validation_policy.py
STRICT_MVP_POLICY = ValidationPolicy(
    max_stops=2,           # Max 2 connections
    max_duration_hours=36, # Max 36 hours total
    require_single_ticket=True,  # Must be single ticket (airline-protected)
)
```

Flights that exceed these limits are **removed entirely** from consideration.

### 2. Multi-Criteria Pruning (Smart Selection)

The `pruning.py` module keeps the best candidates by **multiple criteria** to avoid losing good options:

```python
def prune_flights(flights, config):
    # Keep top K by each criterion, then union
    
    # Criterion 1: Top 5 by lowest cash cost
    by_cash = sorted(flights, key=lambda f: f.cash_cost)[:5]
    
    # Criterion 2: Top 5 by shortest time
    by_time = sorted(flights, key=lambda f: f.total_time_minutes)[:5]
    
    # Criterion 3: Top 5 by best award value
    by_award = sorted(flights, key=lambda f: f.best_award_value(), reverse=True)[:5]
    
    # Criterion 4: Top 5 by fewest stops (prefer nonstop)
    by_stops = sorted(flights, key=lambda f: (f.num_stops, f.total_time_minutes))[:5]
    
    # Union all selections
    selected = set(by_cash + by_time + by_award + by_stops)
    return list(selected)
```

This ensures:
- Cheap flights aren't lost just because they're slower
- Fast flights aren't lost just because they're expensive
- **Nonstop flights are always strongly preferred**

### 3. Objective Function Penalties (Soft Constraints)

The optimizer penalizes connections in the objective function:

#### OOP Mode (Out-of-Pocket)
```python
# $25 penalty per stop
stops_penalty = 25 * num_stops

Objective = minimize(cash_cost + surcharges + stops_penalty)
```

#### CPP Mode (Cents-Per-Point)
```python
# $50 penalty per stop (stronger preference for nonstop in CPP mode)
stops_penalty = 50 * num_stops

Objective = maximize(points_value - stops_penalty)
```

#### Balanced Mode
```python
# 20% value reduction per connection
connection_factor = 1.0 / (1.0 + 0.20 * num_stops)

# 10% penalty for carrier changes (e.g., United → American connection)
carrier_change_penalty = 0.10 if has_carrier_change else 0

# 15% penalty for red-eye flights
redeye_penalty = 0.15 if is_redeye else 0

soft_value = raw_value * connection_factor * (1 - carrier_change_penalty) * (1 - redeye_penalty)
```

### Example: Direct vs. Connecting Trade-off

| Flight | Route | Stops | Time | Cash | Award |
|--------|-------|-------|------|------|-------|
| A | SEA → JFK | 0 | 5h 20m | $480 | 35K United |
| B | SEA → ORD → JFK | 1 | 7h 45m | $320 | 25K United |
| C | SEA → DEN → ORD → JFK | 2 | 11h 20m | $280 | 22K United |

**OOP Mode calculation:**
```
Flight A: $480 + $0 surcharge + $0 stops = $480 effective
Flight B: $320 + $0 surcharge + $25 stops = $345 effective
Flight C: $280 + $0 surcharge + $50 stops = $330 effective

Winner: Flight C (but close to B)
```

**Balanced Mode calculation:**
```
Flight A: Value × 1.0 (no connections) = full value
Flight B: Value × 0.83 (1 connection = 20% penalty)
Flight C: Value × 0.71 (2 connections = 40% total penalty)

Winner: Flight A (nonstop preferred for balanced users)
```

---

## The Three Optimization Modes

### Mode 1: OOP (Out-of-Pocket) - Minimize Cash Spending

**Goal**: Spend as little cash as possible, using points aggressively.

**Objective Function**:
```
Minimize: flight_cash + hotel_cash + surcharges + stops_penalty
```

**When points are used**: Whenever they save **any** money (CPP > 0).

**Best for**: Travelers with lots of points who want to minimize credit card charges.

### Mode 2: CPP (Cents-Per-Point) - Maximize Redemption Value

**Goal**: Only use points when getting excellent value (above threshold).

**Objective Function**:
```
Maximize: points_value (with soft penalty below threshold)
```

**CPP Thresholds by Program** (from `constants.py`):
| Program | Minimum CPP |
|---------|------------|
| United | 1.0¢ |
| Delta | 1.0¢ |
| American | 1.0¢ |
| Singapore | 1.5¢ |
| Hyatt | 1.5¢ |
| Marriott | 0.7¢ |

**Penalty mechanism**: If CPP is below threshold, value is penalized:
```python
if cpp >= threshold:
    soft_value = raw_value  # Full value
elif cpp > 0:
    # Linear penalty: 20% at cpp=0, scaling to 100% at threshold
    penalty_factor = 0.2 + 0.8 * (cpp / threshold)
    soft_value = raw_value * penalty_factor
else:
    soft_value = 0  # Don't use if negative value
```

**Best for**: Points enthusiasts who want to save points for premium redemptions.

### Mode 3: Balanced - Optimize Value, Time, and Convenience

**Goal**: Find the sweet spot between value, speed, and comfort.

**Factors considered**:
1. **Cash savings** (weighted)
2. **Time efficiency** (penalty per hour over baseline)
3. **Connection quality** (20% penalty per stop)
4. **Carrier consistency** (10% penalty for airline changes)
5. **Schedule quality** (15% penalty for red-eye flights)
6. **Availability risk** (30% penalty for low-availability awards)

**Best for**: Business travelers and those who value their time.

---

## How Points Transfers Work

### Transfer Path Modeling

Many travelers have **bank points** (Chase, Amex, Citi) that can transfer to **airline/hotel programs**:

```python
# From constants (transfer graph)
TRANSFER_GRAPH = {
    "chase": {
        "united": 1.0,      # 1:1 ratio
        "hyatt": 1.0,
        "british_airways": 1.0,
        "singapore": 1.0,
    },
    "amex": {
        "delta": 1.0,
        "british_airways": 1.0,
        "hilton": 2.0,      # 1:2 ratio (bonus)
    },
    "citi": {
        "american": 1.0,
        "turkish": 1.0,
    },
}
```

### Integer-Safe Transfer Blocks

Transfers happen in **blocks** (typically 1,000 points minimum):

```python
# Decision variable: how many blocks to transfer
t_blocks["chase"]["united"] = 35  # Transfer 35,000 Chase → United

# Constraint: can't transfer more than balance
t_blocks["chase"]["united"] × 1000 ≤ chase_balance
```

### Funding Source Selection

For each flight/hotel, the optimizer decides:

1. **Pay with cash**, or
2. **Pay with points from**:
   - Native airline miles (e.g., existing United miles)
   - Transferred bank points (e.g., Chase → United)

```python
# Decision variables (binary)
z_cf[flight][payer] = 1  # Cash payment
y_pf[flight][option_id][payer][source] = 1  # Points payment via specific source
```

**Constraint**: Exactly one payment method per selected flight:
```
z_cf[flight] + ∑ y_pf[flight][...] = x_f[flight]  # If flight selected, exactly one payment
```

---

## How Tripy Saves Users Money

### 1. Finding Hidden Award Availability

Tripy searches multiple sources:
- **Award tools**: Direct airline award inventory
- **Cash flights with partner bookings**: Sometimes cash flights can be booked with partner miles at better value
- **Transfer partner opportunities**: A SEA→JFK flight might be bookable via:
  - United (35K miles)
  - Turkish Miles&Smiles (20K miles via Star Alliance)
  - Aeroplan (25K miles)

### 2. Optimal Bank-to-Airline Transfers

The algorithm finds the **best transfer path**:

**Example**: User has 100K Chase, 50K Amex, 30K United miles

| Option | Route | Required Miles | User's Path | Effective Cost |
|--------|-------|----------------|-------------|----------------|
| A | Book via United | 35K United | Use existing miles | 35K United |
| B | Book via Singapore | 30K Singapore | Transfer 30K Chase | 30K Chase |
| C | Book via ANA | 40K ANA | Transfer 40K Amex | 40K Amex |

The optimizer evaluates all paths and selects the one that:
- OOP mode: Uses fewest cash-equivalent points
- CPP mode: Gets best cents-per-point value
- Balanced mode: Balances value with availability and convenience

### 3. Strategic Cash vs. Points Decisions

Sometimes cash is better than points:

```
SEA → JFK options:
• Cash: $280
• Points: 35,000 United + $5.60 taxes = 0.78 cpp

If user values United miles at 1.2 cpp, paying cash saves:
35,000 × $0.012 = $420 of point value for only $280 cash
```

The optimizer makes this calculation automatically based on the selected mode.

### 4. Multi-Segment Optimization

For multi-city trips, the optimizer considers the **entire trip together**:

```
Trip: Seattle → Tokyo → Seoul → Seattle

Without optimization (booking each leg independently):
• SEA → NRT: 70K miles (via United)
• NRT → ICN: 15K miles (via ANA)
• ICN → SEA: 75K miles (via United)
Total: 160K miles from 2 programs

With Tripy optimization:
• SEA → NRT → ICN → SEA: 120K ANA miles (round-the-world routing)
Total: 120K miles from 1 program (40K savings!)
```

### 5. Avoiding High-Surcharge Awards

Some awards have brutal fuel surcharges (e.g., British Airways):

```
Award option: 50K BA Avios + $650 taxes
Cash price: $800

CPP = ($800 - $650) / 50,000 × 100 = 0.30 cpp  ❌ Terrible value
```

The optimizer automatically rejects awards where:
- Surcharge > 50% of cash price
- Surcharge > $300 per segment
- CPP falls below program threshold

---

## Summary

Tripy's optimization algorithm achieves its mission through:

| Capability | How It Works |
|------------|--------------|
| **Airport flexibility** | Search layer expands cities to airports; optimizer picks the best one |
| **Connection handling** | Hard filters (max 2 stops), pruning (keep nonstops), soft penalties in objective |
| **Points optimization** | Three modes (OOP/CPP/Balanced) with program-specific thresholds |
| **Transfer intelligence** | Models bank→airline transfers with correct ratios and bonuses |
| **Money savings** | Compares all payment paths, avoids bad awards, optimizes globally |

The result: Users get mathematically optimal itineraries that maximize their points value while respecting their preferences for cost, time, and convenience.
