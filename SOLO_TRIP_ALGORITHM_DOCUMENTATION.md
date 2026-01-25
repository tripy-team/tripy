# Solo Trip Algorithm Documentation

This document provides a comprehensive overview of how the solo trip itinerary generation algorithm works in Tripy, including edge cases, constraints, and what parameters are negotiable vs non-negotiable.

---

## Table of Contents

1. [Algorithm Overview](#algorithm-overview)
2. [User Input Flow](#user-input-flow)
3. [Algorithm Phases](#algorithm-phases)
4. [Optimization Details](#optimization-details)
5. [Negotiable vs Non-Negotiable Parameters](#negotiable-vs-non-negotiable-parameters)
6. [Edge Cases & Special Handling](#edge-cases--special-handling)
7. [Fallback Mechanisms](#fallback-mechanisms)
8. [Things to Be Aware Of](#things-to-be-aware-of)

---

## Algorithm Overview

The solo trip algorithm uses **Integer Linear Programming (ILP)** to generate optimized travel itineraries. The primary goal is to **minimize out-of-pocket (OOP) costs** while maximizing the use of credit card points and airline miles.

### High-Level Flow

```
User Input → Data Validation → Airport Resolution → Flight Search → ILP Optimization → Result Processing → Itinerary Display
```

### Key Objectives

The optimizer balances three main objectives with weighted priorities:

| Objective | Weight | Priority |
|-----------|--------|----------|
| Maximize Points Value | W1 = 10^6 | Highest |
| Minimize Cash Cost | W2 = 10^3 | Medium |
| Minimize Travel Time | W3 = 1.0 | Lowest |

**Objective Function:**
```
Minimize: (cash_paid + surcharges) + time_penalty - points_value_bonus
```

---

## User Input Flow

### Required Parameters

| Parameter | Description |
|-----------|-------------|
| **Start Destination** | Departure airport code (e.g., JFK, LAX) |
| **End Destination** | Arrival airport code (same as start for round trips) |
| **Destinations** | At least 1 city to visit |
| **Dates** | Either fixed dates OR flexible duration (3-30 days) |

### Optional Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| Maximum Budget | Unlimited | Total cash spending limit |
| Credit Card Points | From profile | Points allocation per card/program |
| Flight Class | Economy | Basic Economy, Economy, Premium, Business, First |
| Include Hotels | True | Whether to include hotel costs |
| Hotel Class | 4-star | 3-star, 4-star, 5-star |
| Number of Bags | 1 | Checked bags (0-6) |
| One-Way Trip | False | If true, end destination can differ from start |

### Input Methods

1. **Manual Form Input**: Traditional form with autocomplete fields
2. **Chatbot Assistant**: Natural language input that extracts parameters
   - Example: *"SEA to NRT, Tokyo + Kyoto, March 10–18, max $3000"*

---

## Algorithm Phases

### Phase 1: Data Collection & Validation

1. **Load Trip Data**: Dates, destinations, budget, travelers
2. **Validate Dates**: 
   - Start date required
   - End date ≥ Start date (if not one-way)
   - Falls back to 7 days if dates missing
3. **Load Destinations**:
   - Filter any excluded destinations
   - Identify start destination (`isStart=True` or first `mustInclude`)
   - Identify end destination (`isEnd=True` or last `mustInclude`)
4. **Load Points Balances**: Aggregate per traveler, normalize program names

### Phase 2: City-to-Airport Resolution

The system converts city names to airport codes using multiple strategies:

```
1. Already a code? → Use it
2. Format "City (CODE1, CODE2)"? → Extract first code
3. Search city_service.search_cities()
4. Fallback: Use OpenAI to suggest airports for small/remote cities
```

### Phase 3: Flight Edge Fetching

Builds a route graph with all origin-destination pairs and fetches flight options in parallel (max 6 concurrent requests).

**Search Strategies (in order):**
1. **Award-First**: AwardTool (points) + SERP (cash) combined
2. **SERP-First**: Cash flights first, then award options
3. **SERP-Only**: Cash-only fallback
4. **Hub Fallback**: For small airports, try nearby hubs

**Each Flight Edge Contains:**
- `cash_cost`: Cash price
- `points_cost`: Points required
- `points_program`: Airline program (UA, DL, AA, etc.)
- `points_surcharge`: Taxes/fees on award bookings
- `time_cost`: Duration in minutes
- `transfer_partners`: Available bank transfer options

### Phase 4: ILP Optimization

The core optimization engine builds and solves an Integer Linear Program.

**Decision Variables:**
- Which flight to take for each segment
- Cash vs points payment for each flight
- Which bank points to transfer (and how much)

**Optimization Modes:**
| Mode | Description |
|------|-------------|
| **OOP** (default) | Minimize out-of-pocket aggressively; uses points even if CPP is low |
| **CPP** | Maximize cents-per-point; only uses points if CPP ≥ 1.0¢ threshold |

### Phase 5: Solution Processing

1. Extract optimal path from ILP solution
2. Calculate costs: total OOP, points used, estimated savings
3. Build transfer plan: which banks → which airlines
4. Generate booking instructions: step-by-step guide

### Phase 6: Day Allocation

How days are distributed across destinations:

| Destination Type | Days Allocated |
|------------------|----------------|
| Origin (departure) | 0 days |
| Return-to-origin | 0 days |
| Stay cities | Days split evenly from total trip length |
| Transit cities | 0 days |

**Example:** 9 days, 3 cities → [3, 3, 3] or [2, 2, 5]

---

## Optimization Details

### Points/Miles Strategy

**Transfer Graph:**
Maps bank programs to airline/hotel programs with transfer ratios:

| Bank | Example Partners | Typical Ratio |
|------|-----------------|---------------|
| Chase Ultimate Rewards | United, Hyatt, Southwest | 1:1 |
| Amex Membership Rewards | Delta, Hilton, JetBlue | 1:1 (Hilton: 1:2) |
| Citi ThankYou | AA, Singapore, Turkish | 1:1 |
| Capital One | BA, Air France, Emirates | 0.75:1 to 1:1 |
| Bilt | AA, United, Hyatt, IHG | 1:1 |

**Transfer Constraints:**
- Minimum transfer: Usually 1,000 points (Capital One: 100)
- Transfer increments: 1,000 point blocks
- Transfer time: Chase/Bilt instant; Amex 1-2 business days

### CPP (Cents-Per-Point) Calculation

```
CPP = (cash_cost - surcharge) / points_cost × 100
```

**Example:**
- Cash price: $800
- Award price: 35,000 miles + $50 surcharge
- CPP = ($800 - $50) / 35,000 × 100 = **2.14¢ per point**

### Surcharge Awareness

Some airlines have high fuel surcharges on award bookings:

| Program | Typical Surcharge |
|---------|-------------------|
| British Airways (BA) | $500-800+ |
| Lufthansa (LH) | $300-500 |
| Virgin Atlantic (VS) | $400-600 |
| Singapore (SQ) | $200-400 |
| Qantas (QF) | $300-500 |

**Workaround:** Book via partner programs with lower surcharges
- Example: BA flight via AA Aadvantage = ~$50 surcharge instead of $500+

---

## Negotiable vs Non-Negotiable Parameters

### 🔴 Non-Negotiable (Hard Constraints)

These constraints **cannot be violated** by the optimizer:

| Constraint | Description |
|------------|-------------|
| **Number of Days** | Total trip duration is fixed; optimizer allocates days to cities |
| **Flow Path** | Must have valid start → end path |
| **Must-Visit Cities** | All intermediate cities marked as `mustInclude` must appear in route |
| **Points Balance** | Cannot exceed available points (bank + airline) |
| **Budget Limit** | Cash + surcharges ≤ maxBudget (per traveler) |
| **Transfer Blocks** | Bank points transfer in minimum increments (default: 1000) |
| **Seat Capacity** | Cannot exceed available award seats |
| **Transfer Partners** | Can only transfer to valid partner programs |

### 🟢 Negotiable (Soft Constraints / Optimized)

These parameters can be adjusted or relaxed:

| Parameter | How It's Flexible |
|-----------|-------------------|
| **Budget** | System retries with 2x, 3x, 5x, 10x multipliers if initial fails |
| **Destinations Order** | Optimizer can reorder intermediate cities to reduce cost |
| **Travel Time** | Optimized but not strictly enforced |
| **Surcharges** | Penalized but not rejected (unless >50% of cash price) |
| **Points Value** | In OOP mode, uses points even if CPP is low |
| **Hotel Inclusion** | Can exclude via `includeHotels=False` |
| **Day Allocation Per City** | Users can adjust days per city (1-10 days) in results view |

### 🟡 User-Adjustable After Generation

| Parameter | Adjustment Method |
|-----------|-------------------|
| Days per city | Slider in results view (1-10 days) |
| Route selection | Click to select different routes |
| Route comparison | Checkbox to compare multiple routes |

---

## Edge Cases & Special Handling

### Small Airport Handling

For regional airports without many direct flights (e.g., ITH - Ithaca):

```
1. Try nearby hub airports: SYR, BUF, ALB, EWR, JFK
2. Add ground transport edge: small airport → hub
3. Generate combined route: ITH → SYR (ground) + SYR → CDG (flight)
```

**Predefined Hub Mappings:**
| Small Airport | Hub Options |
|---------------|-------------|
| ITH (Ithaca) | SYR, BUF, ALB, EWR, JFK |
| Similar pattern for other regional airports |

### Remote/Unusual Cities

For cities not in standard databases:
1. OpenAI fallback suggests appropriate airports
2. AI route suggestions provided instead of failing
3. Step-by-step travel instructions generated

### Geographic Feasibility (Ground Transport)

Ground transport (bus/car) only offered when:
- ✅ Same continent (no ocean crossing)
- ✅ Land border connection exists
- ✅ Within distance limits (bus: ~500mi, car: ~800mi)
- ❌ Not to/from island nations (Japan, UK, Iceland)

### Budget Constraints

**Budget Too Low:**
1. System retries optimization with relaxed budget (2x, 3x, 5x, 10x)
2. Shows warning with recommended minimum budget
3. Falls back to best-effort path if still infeasible

**Budget Calculation:**
```
per_traveler_budget = maxBudget / num_travelers
```

### Insufficient Points

- System pays cash for segments where points are insufficient
- Optimization continues with partial points usage
- No hard failure; graceful degradation

### Date Handling

| Scenario | Handling |
|----------|----------|
| Flexible dates enabled | Uses duration slider (3-30 days) |
| Missing dates | Falls back to default 7 days |
| End date before start | Validation error on frontend |

### Hotel Limitations

- Hotels fetched only for **simple A→B trips**, not multi-city itineraries
- Requires: `includeHotels=True`, valid destination, start/end dates
- If no hotel data available, continues without hotels

### Limited Award Seats

- When award seats < travelers, optimizer decides who uses points vs cash
- Prioritizes travelers with highest point balances for award seats

---

## Fallback Mechanisms

The system has multiple fallback levels to ensure it always returns something:

### Level 1: Relaxed Budget Retry
```
If optimization fails:
  → Retry with 2x budget
  → Retry with 3x budget
  → Retry with 5x budget
  → Retry with 10x budget
```

### Level 2: Best-Effort Path
- Returns path that may exceed budget
- Includes warning about constraints not met

### Level 3: Simple Itineraries
Generates 1-10 route variants:
- Balanced
- Reverse
- Budget-focused
- Extended
- Quick
- Explorer

Uses simple cost estimation (no real flight data).

### Level 4: Minimal Fallback
- Returns placeholder itinerary with warning message
- Never leaves user with nothing

---

## Things to Be Aware Of

### Performance Considerations

| Factor | Impact |
|--------|--------|
| Number of destinations | More destinations = exponentially more routes to evaluate |
| Flexible dates | Searching multiple date ranges takes longer |
| Multiple travelers | Each traveler adds complexity to optimization |
| Points programs | More programs = larger transfer graph |

### Caching & Freshness

| Data Type | Cache TTL | Notes |
|-----------|-----------|-------|
| Award flights | 6 hours | Award availability is volatile |
| Cash flights (SERP) | 90 minutes | Prices change frequently |
| Panorama calendar | 24 hours | Award availability calendar |
| Hotels | 6 hours | |
| Ground transport | 7 days | Stable pricing |

### API Constraints

| API | Constraint |
|-----|------------|
| AwardTool | Max 5 programs per query, 2-day date range max |
| SerpAPI | Rate limits and timeout handling |
| OpenAI | Fallback only; adds latency |

### Cost Estimation Defaults

When flight data is missing:
- Default cash cost: $10,000,000 (effectively infinite)
- Default time: 1,000,000 minutes (effectively infinite)

This ensures missing data doesn't create false "cheap" routes.

### Surcharge Penalties

High-surcharge programs (BA, LH, VS, SQ, QF) receive penalties in the optimization to discourage selection unless significantly cheaper.

### Transfer Time Awareness

- **Instant**: Chase, Bilt
- **1-2 business days**: Amex, Citi, Capital One

System avoids recommending slow-transfer banks if travel is imminent.

### Partner Award Arbitrage

The same physical flight can be booked through multiple programs at different costs:

| Route | Program | Points | Surcharge |
|-------|---------|--------|-----------|
| JFK→LHR on BA metal | BA Executive Club | 26,000 | $500 |
| JFK→LHR on BA metal | AA AAdvantage | 30,000 | $50 |

The optimizer considers all booking options to find the best value.

---

## Summary

| Aspect | Details |
|--------|---------|
| **Algorithm** | Integer Linear Programming (ILP) with PuLP |
| **Primary Goal** | Minimize out-of-pocket costs |
| **Input** | Destinations, dates, budget, points balances |
| **Output** | Optimized itinerary with booking instructions |
| **Fixed** | Trip duration, must-visit cities, points limits |
| **Flexible** | Budget (with retries), destination order, travel time |
| **Fallbacks** | Multiple levels ensure always returns results |

---

*Last Updated: January 2026*
