# Dynamic Destination Routing - Visual Example

## Overview

This document provides a visual walkthrough of how the dynamic destination ordering optimization works for multi-city trips.

## Example Trip: FLL → HND → CDG → MCO

### Trip Parameters
- **Departure City (Fixed):** Fort Lauderdale (FLL)
- **Destinations (Dynamic):** Tokyo Haneda (HND), Paris Charles de Gaulle (CDG)
- **Arrival City (Fixed):** Orlando (MCO)
- **User Points:** 200,000 Chase Ultimate Rewards

### The Optimizer's Process

```
┌─────────────────────────────────────────────────────────────┐
│                    OPTIMIZATION PROCESS                      │
└─────────────────────────────────────────────────────────────┘

Step 1: Identify Constraints
━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ Start City: FLL (FIXED)
✓ End City: MCO (FIXED)
✓ Must Visit: HND, CDG (DYNAMIC ORDER)

Step 2: Generate All Possible Routes
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Route Option A:
    FLL ──────→ HND ──────→ CDG ──────→ MCO
    
Route Option B:
    FLL ──────→ CDG ──────→ HND ──────→ MCO

Step 3: Fetch Flight Data for All Segments
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For Route A:
├─ FLL → HND: Query SERP + AwardTool
├─ HND → CDG: Query SERP + AwardTool
└─ CDG → MCO: Query SERP + AwardTool

For Route B:
├─ FLL → CDG: Query SERP + AwardTool
├─ CDG → HND: Query SERP + AwardTool
└─ HND → MCO: Query SERP + AwardTool

Step 4: Calculate Optimization Metrics
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Detailed Route Comparison

#### Route A: FLL → HND → CDG → MCO

```
Segment 1: FLL → HND
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $1,400
Award Option:      United MileagePlus
  ├─ Points:       70,000
  ├─ Surcharge:    $56
  ├─ Value:        $1,344 saved
  └─ CPP:          1.92

Segment 2: HND → CDG
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $850
Award Option:      Air France Flying Blue
  ├─ Points:       55,000
  ├─ Surcharge:    $120
  ├─ Value:        $730 saved
  └─ CPP:          1.33

Segment 3: CDG → MCO
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $600
Award Option:      Delta SkyMiles
  ├─ Points:       35,000
  ├─ Surcharge:    $85
  ├─ Value:        $515 saved
  └─ CPP:          1.47

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROUTE A TOTALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Cash Price:   $2,850
Total Points:       160,000
Total Surcharges:   $261
Total Value:        $2,589 saved
Average CPP:        1.62
Travel Time:        48 hours
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

#### Route B: FLL → CDG → HND → MCO

```
Segment 1: FLL → CDG
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $1,200
Award Option:      Air France Flying Blue
  ├─ Points:       50,000
  ├─ Surcharge:    $150
  ├─ Value:        $1,050 saved
  └─ CPP:          2.10

Segment 2: CDG → HND
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $950
Award Option:      ANA Mileage Club
  ├─ Points:       88,000
  ├─ Surcharge:    $110
  ├─ Value:        $840 saved
  └─ CPP:          0.95

Segment 3: HND → MCO
━━━━━━━━━━━━━━━━━━━━━
Cash Price:        $1,450
Award Option:      United MileagePlus
  ├─ Points:       75,000
  ├─ Surcharge:    $95
  ├─ Value:        $1,355 saved
  └─ CPP:          1.81

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ROUTE B TOTALS:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Total Cash Price:   $3,600
Total Points:       213,000
Total Surcharges:   $355
Total Value:        $3,245 saved
Average CPP:        1.52
Travel Time:        52 hours
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### Optimization Decision Matrix

```
┌─────────────────────────────────────────────────────────────┐
│                   COMPARISON MATRIX                          │
├─────────────────┬─────────────┬─────────────┬───────────────┤
│     Metric      │   Route A   │   Route B   │    Winner     │
├─────────────────┼─────────────┼─────────────┼───────────────┤
│ Total Points    │  160,000 ✓  │  213,000    │   Route A     │
│ Cash Value      │  $2,589     │  $3,245     │   Route B     │
│ Average CPP     │  1.62 ✓     │  1.52       │   Route A     │
│ Travel Time     │  48 hrs ✓   │  52 hrs     │   Route A     │
│ Surcharges      │  $261 ✓     │  $355       │   Route A     │
│ Feasibility     │  ✓ (160k)   │  ✗ (213k)   │   Route A     │
└─────────────────┴─────────────┴─────────────┴───────────────┘

DECISION: Route A (FLL → HND → CDG → MCO)

Reasoning:
1. User has 200k points - Route A uses 160k ✓, Route B needs 213k ✗
2. Route A has better average CPP (1.62 vs 1.52)
3. Route A has shorter travel time (48h vs 52h)
4. Route A has lower surcharges ($261 vs $355)

Weighted Score (W1=10^6, W2=10^3, W3=1.0):
Route A: (10^6 × 2589) - (10^3 × 261) - (1.0 × 2880) = 2,588,477,120
Route B: Infeasible (exceeds points balance)
```

### Transfer Instructions Generated

```
┌─────────────────────────────────────────────────────────────┐
│            TRANSFER INSTRUCTIONS FOR ROUTE A                 │
└─────────────────────────────────────────────────────────────┘

Transfer 1: FLL → HND (United MileagePlus)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source:    Chase Ultimate Rewards
Points:    70,000
Partner:   United MileagePlus
Value:     1.92 cpp ($1,344 saved)
Timing:    Instant transfer
Portal:    https://www.chase.com/ultimate-rewards
Book at:   https://www.united.com/en/us/fsr/choose-flights
Surcharge: $56.00

Step-by-step:
1. Visit Chase Ultimate Rewards portal
2. Navigate to 'Transfer Points' section
3. Select United MileagePlus
4. Enter United frequent flyer number
5. Transfer 70,000 points (1:1 ratio, instant)
6. Visit United booking portal
7. Search for FLL → HND award flights
8. Book using 70,000 miles + $56 in taxes

Transfer 2: HND → CDG (Air France Flying Blue)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source:    Chase Ultimate Rewards
Points:    55,000
Partner:   Air France / KLM Flying Blue
Value:     1.33 cpp ($730 saved)
Timing:    Instant transfer
Portal:    https://www.chase.com/ultimate-rewards
Book at:   https://www.airfrance.com/
Surcharge: $120.00

Step-by-step:
1. Visit Chase Ultimate Rewards portal
2. Navigate to 'Transfer Points' section
3. Select Air France / KLM Flying Blue
4. Enter Flying Blue membership number
5. Transfer 55,000 points (1:1 ratio, instant)
6. Visit Air France booking portal
7. Search for HND → CDG award flights
8. Book using 55,000 miles + $120 in taxes

Transfer 3: CDG → MCO (Delta SkyMiles)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Source:    Chase Ultimate Rewards
Points:    35,000
Partner:   Delta SkyMiles
Value:     1.47 cpp ($515 saved)
Timing:    Instant transfer
Portal:    https://www.chase.com/ultimate-rewards
Book at:   https://www.delta.com/flight-search/book-a-flight
Surcharge: $85.00

Step-by-step:
1. Visit Chase Ultimate Rewards portal
2. Navigate to 'Transfer Points' section
3. Select Delta SkyMiles
4. Enter SkyMiles membership number
5. Transfer 35,000 points (1:1 ratio, instant)
6. Visit Delta booking portal
7. Search for CDG → MCO award flights
8. Book using 35,000 miles + $85 in taxes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRATEGY SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
For your multi-city route (FLL → HND → CDG → MCO), 
using Chase Ultimate Rewards as your primary points source, 
leveraging 3 airline partners for optimal routing, 
saving $2,589.00 (1.62 cpp), 
based on live award availability from AwardTool.

Total Points Used:    160,000 / 200,000 available
Total Cash Saved:     $2,589.00
Average Value:        1.62 cents per point
Total Surcharges:     $261.00
Remaining Points:     40,000
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## Key Optimization Features

### 1. Constraint Satisfaction
```
✓ Start and end cities are FIXED
✓ Intermediate cities can be reordered
✓ All cities must be visited exactly once
✓ Points balance must not be exceeded
✓ Cash budget must not be exceeded
```

### 2. Multi-Objective Optimization
```
Priority 1: Maximize Points Value (W1 = 10^6)
    → Cash saved by using points vs paying cash
    → Only use points when value ≥ 1.0 cpp

Priority 2: Minimize Cash Cost (W2 = 10^3)
    → Total out-of-pocket (surcharges + any cash flights)
    
Priority 3: Minimize Travel Time (W3 = 1.0)
    → Total hours in transit
```

### 3. Real-Time Data Integration
```
SERP API:      Cash flight prices + schedules
AwardTool:     Award availability + points costs
Panorama:      Calendar view for best dates
Cache Layer:   6h cache for award data, 90m for SERP
```

### 4. Transfer Optimization
```
✓ Automatically selects best transfer partners
✓ Considers transfer ratios (1:1, 2:1.5, etc.)
✓ Accounts for transfer timing (instant vs 1-2 days)
✓ Respects minimum transfer amounts
✓ Provides direct portal URLs
```

## Example with Codeshare

### Scenario: FLL → ICN (Seoul) via Delta/Korean Air Codeshare

```
Option Found:
━━━━━━━━━━━━
Flight:       KE052 (Korean Air metal)
Booking Via:  Delta SkyMiles
Points:       80,000
Cash Value:   $1,650
Surcharge:    $110
Value Saved:  $1,540
CPP:          1.93

Transfer Instructions:
━━━━━━━━━━━━━━━━━━━━━
Transfer 80,000 points from Chase Ultimate Rewards to Delta SkyMiles.
You'll book through Delta SkyMiles to fly on Korean Air metal (codeshare).

Step-by-step:
1. Visit Chase portal: https://www.chase.com/ultimate-rewards
2. Transfer to Delta SkyMiles (instant, 1:1)
3. Visit Delta booking: https://www.delta.com/flight-search/book-a-flight
4. Search FLL → ICN on your travel dates
5. Look for flights operated by Korean Air (KE flight numbers)
6. Book using 80,000 SkyMiles + $110 taxes
7. Your ticket will be issued by Delta but flight operated by Korean Air

Note: Korean Air is a SkyTeam partner of Delta. You'll enjoy Korean Air's 
excellent service while using Delta miles!
```

## Performance Characteristics

### Computation Time
```
2-city trip:    ~3-5 seconds
3-city trip:    ~8-12 seconds
4-city trip:    ~15-25 seconds
5-city trip:    ~30-45 seconds

Factors:
- Number of permutations to evaluate
- API response times (SERP + AwardTool)
- ILP solver complexity
- Cache hit rate
```

### Scalability
```
Destination Combinations:
2 cities:  2! = 2 routes
3 cities:  3! = 6 routes
4 cities:  4! = 24 routes
5 cities:  5! = 120 routes

Note: The ILP optimizer is smart and prunes 
infeasible routes early, so actual computation
is much faster than brute force.
```

## Real-World Impact

### User Experience
```
Before: "I should go to Tokyo then Paris... or Paris then Tokyo?"
After:  "System automatically found Tokyo → Paris saves $450 more!"

Before: "How do I transfer Chase points to United?"
After:  Click portal link → Follow 8 clear steps → Transfer complete

Before: "What's a good redemption value?"
After:  See exact cpp (1.62) and total savings ($2,589)

Before: "Is this a codeshare flight?"
After:  Clear indication: "Book via Delta to fly Korean Air metal"
```

### Business Value
```
✓ Higher booking conversion (clearer instructions)
✓ Better points optimization (dynamic routing)
✓ Increased user trust (transparent value calculations)
✓ Reduced support tickets (comprehensive guides)
✓ Competitive advantage (most detailed transfer instructions)
```

## Conclusion

The dynamic routing system provides:
1. **Automatic optimization** of destination order
2. **Comprehensive comparison** of all route options
3. **Detailed transfer instructions** with URLs and timing
4. **Value transparency** with cpp and savings calculations
5. **Codeshare clarity** for complex partner bookings

Users get the best possible route with clear, actionable instructions to book it!
