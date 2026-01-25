# AwardTool API Points Transfer Strategy

## Overview
This document outlines the strategic approach for using the AwardTool API to determine optimal credit card points transfers to airline partners for award bookings.

## Core Strategy Philosophy

### 1. **Data-Driven Decision Making**
- Use **real-time award availability** from AwardTool API, not guesswork
- Prioritize routes with confirmed award seat availability
- Calculate actual cents-per-point (CPP) value for each redemption option

### 2. **Value Maximization**
- Only transfer points when redemption value is ≥1.0 CPP (configurable threshold)
- Compare multiple airline partners to find best value
- Factor in taxes/surcharges to calculate true out-of-pocket cost

### 3. **Multi-Source Optimization**
- Evaluate all available credit card point sources (Chase UR, Amex MR, Citi TY, Capital One, Bilt)
- Match point sources to airline partners that maximize value
- Consider native airline miles before transferring bank points

---

## API Integration Strategy

### Phase 1: Discovery - Find Available Awards

#### AwardTool Panorama Calendar API
**Endpoint**: `https://www.awardtool-api.com/panorama/panorama_calendar_data`

**Purpose**: Quickly identify which dates have award availability

**Implementation**:
```python
# Fast calendar scan (30-90 days) to prune dates without availability
async def fetch_awardtool_calendar(origin, destination, api_key):
    payload = {
        "origin_1": origin,
        "destination": destination,
        "origin_2": None,
        "programs": ["UA", "AA", "DL", "AS", "BA", "AF", "SQ"],  # Top programs
        "key": api_key
    }
    response = await client.post(
        "https://www.awardtool-api.com/panorama/panorama_calendar_data",
        json=payload
    )
    # Returns: dates with min_points and programs with availability
```

**Strategy Output**:
- Eliminate dates with no award availability
- Identify which programs have best availability on desired dates
- Reduce real-time API calls by 80%+ (only query dates with inventory)

---

### Phase 2: Real-Time Award Pricing

#### AwardTool Search Real-Time API
**Endpoint**: `https://www.awardtool-api.com/search_real_time`

**Purpose**: Get exact points required, surcharges, and routing for specific dates

**Implementation**:
```python
async def fetch_award_details(origin, destination, date, programs, cabin="economy"):
    payload = {
        "origin": origin,
        "destination": destination,
        "departure_date": date,
        "programs": programs,  # e.g., ["UA", "DL", "AA"]
        "cabin_types": [cabin],
        "passengers": {"adults": 2, "children": 0},
        "key": AWARDTOOL_API_KEY
    }
    
    response = await client.post(
        "https://www.awardtool-api.com/search_real_time",
        json=payload,
        timeout=30
    )
    
    # Returns for EACH program:
    # - award_points: exact miles needed
    # - surcharge: taxes/fees in USD
    # - flights: routing, carriers, segments
    # - cabin_type: confirmed cabin class
```

**Critical Data Extracted**:
1. **Points Required**: Exact miles needed per program
2. **Surcharge**: Out-of-pocket taxes/fees
3. **Operating Carrier**: For codeshare instructions (e.g., "Book via Delta, fly Korean Air")
4. **Routing**: Stops, connections, flight numbers

---

### Phase 3: Transfer Path Optimization

#### Credit Card → Airline Transfer Mapping

**Transfer Graph** (from `award_programs.py`):
```python
TRANSFER_PARTNERS = {
    "Chase Ultimate Rewards": ["UA", "BA", "AF", "SQ", "VS"],
    "Amex Membership Rewards": ["DL", "BA", "AF", "SQ", "NH", "AV", "VS", "EY", "QR"],
    "Citi ThankYou Points": ["QF", "TK", "EY", "SQ", "QR", "AF", "VS"],
    "Capital One Miles": ["AF", "BA", "EY", "QR", "TK", "SQ"],
    "Bilt Rewards": ["UA", "AA", "BA", "AF", "TK", "EY", "QR"]
}
```

**Strategy Algorithm**:

1. **Input Data** (from AwardTool):
   ```json
   {
     "route": "SFO → HKG",
     "date": "2026-03-15",
     "award_options": [
       {
         "program": "UA",
         "points": 70000,
         "surcharge": 56.30,
         "cash_equivalent": 850.00
       },
       {
         "program": "SQ",
         "points": 85000,
         "surcharge": 120.00,
         "cash_equivalent": 850.00
       }
     ]
   }
   ```

2. **Calculate Value** (cents per point):
   ```python
   def calculate_cpp(cash_price, points, surcharge):
       cash_saved = cash_price - surcharge
       return (cash_saved * 100) / points
   
   # UA: (850 - 56.30) * 100 / 70000 = 1.13 CPP ✓ Good value
   # SQ: (850 - 120) * 100 / 85000 = 0.86 CPP ✗ Below threshold
   ```

3. **Match to Point Sources**:
   ```python
   # User has:
   # - 100,000 Chase UR
   # - 50,000 Amex MR
   
   # UA option (70k points, 1.13 CPP):
   # Chase UR → United (1:1 transfer) ✓ Available
   # Result: Transfer 70,000 Chase UR → United
   ```

---

## Transfer Decision Framework

### Decision Tree

```
1. Does route have award availability? (Panorama API)
   ↓ YES
2. Fetch exact pricing from Real-Time API for all programs
   ↓
3. Calculate CPP for each option:
   CPP = (cash_price - surcharge) * 100 / points_required
   ↓
4. Filter options where CPP ≥ 1.0 (configurable threshold)
   ↓
5. Match remaining options to user's point balances:
   - Check which credit cards can transfer to which airlines
   - Verify sufficient balance (including transfer minimums)
   ↓
6. Rank by:
   a) CPP value (higher is better)
   b) Surcharge (lower is better)
   c) Routing quality (fewer stops, better times)
   ↓
7. Select optimal transfer strategy
```

---

## Specific Transfer Scenarios

### Scenario 1: Simple Round-Trip
**User Request**: SFO → LHR round-trip, 2 passengers

**Strategy**:
1. **Panorama Scan** (parallel for outbound and return dates):
   ```python
   outbound_calendar = await panorama_calendar("SFO", "LHR", api_key)
   return_calendar = await panorama_calendar("LHR", "SFO", api_key)
   ```

2. **Filter Viable Dates**:
   - User wants March 10-20
   - Panorama shows BA, VS, AF have availability March 12-18
   - Narrow search to those dates

3. **Real-Time Pricing** (for top 3 programs):
   ```python
   programs_to_check = ["BA", "VS", "AF"]  # From panorama results
   outbound = await realtime_search("SFO", "LHR", "2026-03-12", programs_to_check)
   return_flight = await realtime_search("LHR", "SFO", "2026-03-18", programs_to_check)
   ```

4. **Transfer Calculation**:
   ```
   BA Option:
   - Outbound: 13,000 Avios + $56 per person
   - Return: 13,000 Avios + $56 per person
   - Total: 52,000 Avios + $224 for 2 pax
   - Cash price: $1,200 per person = $2,400 total
   - CPP: (2400 - 224) * 100 / 52000 = 4.18 CPP ✓ Excellent
   
   Transfer Strategy:
   - Chase UR → British Airways (1:1)
   - Transfer: 52,000 Chase UR
   - Out-of-pocket: $224
   ```

---

### Scenario 2: Multi-City Complex Routing
**User Request**: NYC → Tokyo → Bali → Singapore → NYC (3 passengers)

**Strategy**:
1. **Break into Segments**:
   - JFK → NRT (Segment 1)
   - NRT → DPS (Segment 2)
   - DPS → SIN (Segment 3)
   - SIN → JFK (Segment 4)

2. **Parallel Panorama Scans**:
   ```python
   segments = [
       ("JFK", "NRT", "2026-06-01"),
       ("NRT", "DPS", "2026-06-08"),
       ("DPS", "SIN", "2026-06-15"),
       ("SIN", "JFK", "2026-06-22")
   ]
   
   calendars = await asyncio.gather(*[
       panorama_calendar(orig, dest, key) 
       for orig, dest, _ in segments
   ])
   ```

3. **Optimization** (using ILP solver from `points_maximizer.py`):
   ```python
   solution = plan_maximize_points_value(
       travelers=["Passenger1", "Passenger2", "Passenger3"],
       cities=["JFK", "NRT", "DPS", "SIN"],
       # AwardTool data for edges:
       award_points={"UA": {("JFK","NRT"): 75000}, "NH": {("JFK","NRT"): 88000}},
       cash_surcharge={"UA": {("JFK","NRT"): 120.00}, "NH": {("JFK","NRT"): 45.00}},
       # User balances:
       source_balances={
           ("Passenger1", "chase"): 150000,
           ("Passenger1", "amex"): 80000
       },
       # Transfer graph:
       allowed_sa={("chase", "UA"), ("amex", "NH"), ("amex", "SQ")},
       min_points_value_cpp=1.2  # Higher threshold for complex trips
   )
   ```

4. **Transfer Strategy Output**:
   ```
   Your Transfer Strategy:
   
   1. Transfer 75,000 Chase UR → United MileagePlus
      - For: JFK → NRT (Segment 1)
      - Value: 1.45 CPP
      - Surcharge: $120 per person = $360 total
   
   2. Transfer 30,000 Amex MR → All Nippon Airways
      - For: NRT → DPS (Segment 2)
      - Value: 1.62 CPP
      - Surcharge: $85 total
   
   3. Transfer 25,000 Chase UR → Singapore Airlines KrisFlyer
      - For: DPS → SIN + SIN → JFK (Segments 3-4)
      - Value: 1.38 CPP
      - Surcharge: $240 total
   
   Total Points: 130,000 (from 2 card programs)
   Total Out-of-Pocket: $685
   Total Cash Value: $8,500
   Overall CPP: 6.01 (exceptional value)
   ```

---

### Scenario 3: Hybrid Cash + Points
**User Request**: Best out-of-pocket for NYC → Dubai

**Strategy**: Compare **all** payment methods:

1. **Cash-Only** (from SerpAPI):
   ```
   Google Flights: $950 per person
   ```

2. **Points Options** (from AwardTool):
   ```
   EK (Emirates): 62,500 miles + $450 surcharge
   QR (Qatar): 42,500 miles + $120 surcharge
   EY (Etihad): 55,000 miles + $85 surcharge
   ```

3. **Calculate True Cost**:
   ```python
   # User has: 100k Amex MR, $500 cash budget
   
   Option A: Pay cash
   - Cost: $950
   - Points saved: 100,000 MR
   
   Option B: Amex MR → Qatar
   - Transfer: 42,500 MR → Qatar
   - Cost: $120 surcharge
   - CPP: (950 - 120) * 100 / 42500 = 1.95 CPP ✓ Excellent
   - Points remaining: 57,500 MR
   
   Option C: Amex MR → Etihad
   - Transfer: 55,000 MR → Etihad
   - Cost: $85 surcharge
   - CPP: (950 - 85) * 100 / 55000 = 1.57 CPP ✓ Good
   - Points remaining: 45,000 MR
   
   RECOMMENDATION: Option B (Qatar)
   - Best CPP value
   - Lowest surcharge
   - Preserves most points for future use
   ```

---

## Implementation: Step-by-Step Transfer Instructions

### Generated Instructions (based on AwardTool data):

```markdown
## Your Booking Instructions

### Step 1: Transfer Points to United MileagePlus

**Transfer Summary**
┌────────────────────────────────────────┐
│ 💳 From: Chase Ultimate Rewards        │
│ 🔄 Amount: 70,000 points               │
│ ✈️  To: United MileagePlus             │
│ 🎫 For Flight: SFO → HKG               │
│ 💵 Taxes/Fees: ~$56 per person         │
└────────────────────────────────────────┘

**Instructions**:
1. Log in to Chase.com
2. Navigate to "Ultimate Rewards" → "Use Points" → "Transfer to Travel Partners"
3. Select "United MileagePlus" from the airline list
4. Enter your United MileagePlus number: [user inputs]
5. Enter transfer amount: 70,000
6. Confirm transfer (instant, but allow up to 24 hours)

### Step 2: Book Award Flight

Once points appear in your United account:

1. Go to United.com
2. Search: SFO → HKG on March 15, 2026
3. Select "Book with miles" option
4. Choose the flight showing **70,000 miles + $56.30**
5. Complete booking with your United account

**Important**: This flight operates as a codeshare with ANA (All Nippon Airways). You'll book through United but fly on ANA metal.
```

---

## Advanced Strategies

### 1. **Transfer Bonuses**
Monitor and incorporate periodic transfer bonuses:

```python
# Example: Chase → United 30% bonus
TRANSFER_BONUSES = {
    ("chase", "UA"): 1.30,  # 30% bonus through March 31
    ("amex", "VS"): 1.15,   # 15% bonus ongoing
}

# Adjust optimization:
def calculate_effective_cpp(cash_saved, points, bonus_ratio):
    # If transferring 50k with 30% bonus = 65k delivered
    delivered_points = points / bonus_ratio
    return (cash_saved * 100) / delivered_points

# 70k United miles with 30% bonus:
# Only transfer 53,846 Chase UR → receive 70,000 United miles
# CPP = (794 * 100) / 53846 = 1.47 CPP (improved from 1.13!)
```

### 2. **Native Miles First**
Always check native airline miles before transferring:

```python
# User has 50,000 United miles in account
# Route needs 70,000 United miles

Option A: Transfer 70k Chase → United (use 0 existing United miles)
Option B: Transfer 20k Chase → United (use 50k existing United miles)

STRATEGY: Option B
- Preserves Chase UR flexibility
- Uses "trapped" United miles first
```

### 3. **Seat Availability Constraints**
Factor in award seat limits:

```python
# AwardTool returns "products": [{"business_award_seats": 2}]
award_data = {
    "UA": {"seats_available": 4},  # ✓ Can book 3 passengers
    "SQ": {"seats_available": 1},  # ✗ Need 3 seats
}

# Automatically exclude SQ from optimization
filtered_programs = [
    p for p in programs 
    if award_data[p]["seats_available"] >= num_passengers
]
```

### 4. **Multi-Payer Optimization**
For group travel where multiple people can pay:

```python
# 3 travelers, 2 have points
travelers = ["Alice", "Bob", "Charlie"]
point_sources = {
    "Alice": {"chase": 80000, "amex": 50000},
    "Bob": {"chase": 60000},
    "Charlie": {"chase": 0}  # No points
}

# Optimize who pays for whom:
solution = plan_maximize_points_value(
    travelers=travelers,
    can_pay_for={
        ("Alice", "Alice"): 1,
        ("Alice", "Bob"): 1,
        ("Alice", "Charlie"): 1,
        ("Bob", "Bob"): 1,
        ("Bob", "Charlie"): 1,
    },
    # ... other params
)

# Output might be:
# Alice transfers 70k Chase → UA for herself + Charlie
# Bob transfers 35k Chase → UA for himself
```

---

## Error Handling & Fallbacks

### When AwardTool API Fails

```python
async def fetch_award_with_fallback(origin, destination, date):
    try:
        # Try real-time API
        return await awardtool_realtime(origin, destination, date)
    except HTTPError as e:
        if e.status_code == 429:  # Rate limit
            # Fall back to cached panorama data
            return await get_panorama_estimate(origin, destination, date)
        elif e.status_code >= 500:
            # AwardTool service issue
            logger.warning(f"AwardTool API down, using historical averages")
            return get_historical_award_pricing(origin, destination)
        else:
            raise
```

### No Award Availability

```python
if not award_options:
    # Strategy: Show cash price, suggest alerts
    return {
        "strategy": "cash",
        "reason": "No award availability found for your dates",
        "suggestions": [
            "Try flexible dates (+/- 3 days)",
            "Set up ExpertFlyer alert for your route",
            "Consider positioning flights (nearby airports)"
        ],
        "cash_options": await serp_api_search(...)
    }
```

---

## Performance Optimization

### 1. **Caching Strategy**
```python
CACHE_TTL = {
    "panorama_calendar": 3600,  # 1 hour (availability changes slowly)
    "realtime_pricing": 300,    # 5 minutes (prices fluctuate)
    "transfer_graph": 86400,    # 24 hours (rarely changes)
}
```

### 2. **Parallel API Calls**
```python
# Instead of sequential:
out1 = await awardtool_realtime(origin, dest, date1, programs)
out2 = await awardtool_realtime(origin, dest, date2, programs)

# Do parallel:
out1, out2 = await asyncio.gather(
    awardtool_realtime(origin, dest, date1, programs),
    awardtool_realtime(origin, dest, date2, programs)
)
# Reduces latency by 50%
```

### 3. **Smart Program Pruning**
```python
# Don't query all 20 programs; use panorama to prune first
panorama = await panorama_calendar(origin, dest)
top_programs = [
    p for p, data in panorama.items() 
    if data["min_points"] < 100000  # Filter unreasonably high
][:5]  # Top 5 only

# Then do real-time for just those 5
realtime = await awardtool_realtime(origin, dest, date, top_programs)
```

---

## Monitoring & Analytics

### Track Transfer Strategy Metrics

```python
METRICS = {
    "avg_cpp": 1.85,                    # Average cents per point redeemed
    "transfer_success_rate": 0.94,      # % of transfers that found value
    "avg_surcharge_per_ticket": 125.50, # Average taxes/fees
    "preferred_programs": {             # Most-used transfer partners
        "UA": 0.35,  # 35% of transfers
        "BA": 0.22,
        "SQ": 0.18,
    }
}
```

---

## Summary: The Complete Flow

```
User Input: "NYC → Tokyo, March 10-20, 2 passengers"
                    ↓
┌─────────────────────────────────────────────────────┐
│ 1. Panorama Calendar API (Discovery)                │
│    - Scan 10 days for award availability            │
│    - Filter to: March 12, 14, 17 (have awards)      │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 2. Real-Time API (Exact Pricing)                    │
│    - Programs: UA, NH, AA, BA                       │
│    - Get points + surcharge for March 12            │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 3. Value Calculation                                │
│    UA: 60k pts + $120 = 1.52 CPP ✓                  │
│    NH: 88k pts + $45 = 1.31 CPP ✓                   │
│    AA: 70k pts + $350 = 0.91 CPP ✗ (below 1.0)     │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 4. Match to User's Points                           │
│    - User has: 150k Chase UR, 80k Amex MR           │
│    - Chase → UA (yes), Chase → NH (no)              │
│    - Amex → NH (yes)                                │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 5. Optimal Transfer Decision                        │
│    WINNER: United (60k Chase UR)                    │
│    - Best CPP: 1.52                                 │
│    - Lowest surcharge: $120 total                   │
│    - User has sufficient Chase UR balance           │
└─────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────┐
│ 6. Generate Instructions                            │
│    - Transfer: 60k Chase UR → United                │
│    - Book: united.com, 60k miles + $60 per person   │
│    - Operating carrier: ANA (from AwardTool data)   │
└─────────────────────────────────────────────────────┘
```

---

## Key Takeaways

1. **Always use AwardTool data** - Never guess award pricing or availability
2. **Panorama first, real-time second** - Prune dates before expensive real-time calls
3. **Calculate true CPP** - Factor in surcharges, not just points required
4. **Match strategically** - Not all credit cards transfer to all airlines
5. **Optimize holistically** - Consider multi-leg trips as a system, not individual flights
6. **Provide clear instructions** - Users need step-by-step guidance with exact numbers
7. **Handle errors gracefully** - Always have fallback strategies

---

## Next Steps for Implementation

### Priority 1: Core Infrastructure
- ✅ AwardTool API client (completed)
- ✅ Transfer graph mapping (completed)
- ✅ CPP calculation logic (completed)

### Priority 2: Optimization Engine
- ✅ ILP solver for multi-leg optimization (completed)
- ✅ Native miles vs transfer decision (completed)
- ⚠️  Transfer bonus integration (partially implemented)

### Priority 3: User Experience
- ✅ Transfer strategy overview UI (completed)
- ✅ Step-by-step booking instructions (completed)
- ⚠️  Real-time availability alerts (not yet implemented)

### Priority 4: Advanced Features
- ⬜ Multi-payer group optimization UI
- ⬜ Historical pricing trends
- ⬜ Predictive availability modeling
- ⬜ Transfer bonus tracking & notifications
