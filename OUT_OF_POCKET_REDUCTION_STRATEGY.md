# Strategy: Reducing Out-of-Pocket Costs with Tripy

## Executive Summary

This document outlines implementation strategies to minimize out-of-pocket (OOP) expenses when booking travel through Tripy's award flight optimization system. By leveraging the existing ILP optimizer, transfer graph, and multi-source flight data, we can systematically reduce cash expenditure while maximizing the value extracted from credit card points and airline miles.

---

## Core Principles

### The OOP Reduction Formula

```
OOP_Reduction = Cash_Fare - (Points_Cost × Redemption_Value + Taxes/Surcharges)
```

**Goal**: Maximize `OOP_Reduction` across all flight segments while maintaining acceptable travel quality.

### Key Levers for OOP Reduction

| Lever | Impact | Implementation Complexity |
|-------|--------|---------------------------|
| Points redemption optimization | High | Already implemented |
| Transfer partner arbitrage | High | Partially implemented |
| Surcharge minimization | Medium | Needs enhancement |
| Date/route flexibility | High | Partially implemented |
| Credit card benefit stacking | Medium | Needs implementation |
| Positioning flight optimization | Medium | Needs enhancement |

---

## Strategy 1: Maximize Points Value (CPP Optimization)

### Current Implementation

The system already calculates cents-per-point (CPP) value:

```python
# From points_maximizer.py
points_value = (cash_cost - surcharge) / points_cost × 100
```

### Enhancement: Dynamic CPP Thresholds

**Problem**: The current 1.0 CPP minimum threshold is static. Some programs consistently offer higher value, while others rarely exceed 1.2 CPP.

**Solution**: Implement program-specific minimum thresholds:

```python
PROGRAM_CPP_THRESHOLDS = {
    # Premium long-haul programs - higher expected value
    "SQ": 1.5,  # Singapore Airlines - typically 1.5-3 CPP
    "ANA": 1.5, # ANA - excellent value on international
    "VS": 1.3,  # Virgin Atlantic - good partner awards
    
    # US Domestic - lower thresholds acceptable
    "UA": 1.0,
    "AA": 1.0,
    "DL": 1.0,
    
    # High-surcharge programs - need higher CPP to offset
    "BA": 1.8,  # British Airways - fuel surcharges
    "LH": 1.6,  # Lufthansa - significant surcharges
}
```

### Enhancement: Surcharge-Aware Optimization

**Implementation Approach**:

1. **Modify the objective function** to penalize high-surcharge awards:

```python
# Enhanced objective function
Maximize:
  W1 × points_value 
  - W2 × cash_paid 
  - W3 × time_penalty 
  - W_surcharge × surcharge_amount  # NEW: Penalize surcharges
  + W_benefit × card_benefits
```

2. **Add surcharge caps** as hard constraints:

```python
# In points_maximizer.py - add constraint
def add_surcharge_constraints(prob, edges, travelers, max_surcharge_per_segment=150):
    """Reject awards where surcharges exceed threshold"""
    for edge in edges:
        surcharge = get_tax(edge.airline, edge)
        if surcharge > max_surcharge_per_segment:
            # Force cash payment instead of high-surcharge award
            prob += x[(edge, "award")] == 0
```

---

## Strategy 2: Transfer Partner Arbitrage

### Current Implementation

The transfer graph connects bank points to airlines:

```python
DEFAULT_TRANSFER_GRAPH = {
    "chase": {"UA": 1.0, "BA": 1.0, "AF": 1.0, "SQ": 1.0, ...},
    "amex": {"UA": 1.0, "AA": 1.0, "DL": 1.0, "AF": 1.0, ...},
    # ...
}
```

### Enhancement: Partner Award Integration

**Problem**: The same flight can be booked through multiple programs at different point costs.

**Example**: JFK → LHR on British Airways can be booked through:
- BA Executive Club: 26,000 Avios + $500 surcharge
- AA AAdvantage: 30,000 miles + $50 surcharge (partner award)
- AS Mileage Plan: 25,000 miles + $50 surcharge (partner award)

**Solution**: Expand edge generation to include partner awards:

```python
def generate_partner_award_edges(flight, available_programs):
    """
    For each flight, generate edges for all booking programs
    that can access that flight.
    """
    edges = []
    operating_airline = flight.operating_carrier
    
    # Partner award mappings
    PARTNER_AWARDS = {
        "BA": ["AA", "AS", "IB", "QR"],  # OneWorld
        "UA": ["AC", "LH", "TK", "SQ"],  # Star Alliance
        "DL": ["AF", "KL", "VS"],         # SkyTeam
    }
    
    # Generate edge for operating airline
    edges.append(create_edge(flight, operating_airline, "native"))
    
    # Generate edges for partner programs
    for partner in PARTNER_AWARDS.get(operating_airline, []):
        if partner in available_programs:
            partner_cost = lookup_partner_award_cost(flight, partner)
            partner_surcharge = lookup_partner_surcharge(flight, partner)
            edges.append(create_edge(flight, partner, "partner",
                                    points=partner_cost,
                                    surcharge=partner_surcharge))
    
    return edges
```

### Enhancement: Transfer Bonus Tracking

**Problem**: Banks frequently offer transfer bonuses (e.g., 30% bonus Chase → Hyatt).

**Solution**: Dynamic transfer ratio updates:

```python
def get_current_transfer_ratio(bank, airline):
    """
    Check for active transfer bonuses and return effective ratio.
    """
    base_ratio = DEFAULT_TRANSFER_GRAPH[bank].get(airline, None)
    if base_ratio is None:
        return None
    
    # Check active promotions (could be stored in DB or fetched from API)
    active_bonus = get_active_transfer_bonus(bank, airline)
    if active_bonus:
        # Example: 30% bonus means 1000 points becomes 1300 miles
        return base_ratio * (1 + active_bonus.bonus_percentage / 100)
    
    return base_ratio
```

---

## Strategy 3: Route Optimization for Lower OOP

### Current Implementation

The system finds nearby hubs for small airports:

```python
SMALL_AIRPORT_NEARBY_HUBS = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],
    # ...
}
```

### Enhancement: Award Availability Routing

**Problem**: Direct flights may only have expensive cash fares, while connecting itineraries have award availability.

**Solution**: Implement award-aware routing:

```python
def find_award_friendly_routes(origin, destination, date, points_balance):
    """
    Find routes that maximize award availability, even if not the shortest.
    """
    routes = []
    
    # Strategy 1: Direct route
    direct = search_direct(origin, destination, date)
    routes.append(evaluate_route(direct, points_balance))
    
    # Strategy 2: Traditional hub routing
    for hub in MAJOR_HUBS:
        leg1 = search_flights(origin, hub, date)
        leg2 = search_flights(hub, destination, date)
        if leg1 and leg2:
            routes.append(evaluate_route([leg1, leg2], points_balance))
    
    # Strategy 3: Sweet-spot routing (known good award routes)
    sweet_spots = get_award_sweet_spots(origin, destination)
    for ss in sweet_spots:
        ss_route = search_sweet_spot_route(ss, date)
        routes.append(evaluate_route(ss_route, points_balance))
    
    # Return route with lowest OOP
    return min(routes, key=lambda r: r.out_of_pocket)

AWARD_SWEET_SPOTS = {
    # These routes often have excellent award availability/pricing
    ("JFK", "CDG"): [
        {"via": None, "program": "AF", "typical_cost": 30000},
        {"via": "DUB", "program": "AA", "typical_cost": 25000},  # Aer Lingus
    ],
    ("LAX", "NRT"): [
        {"via": None, "program": "NH", "typical_cost": 45000},  # ANA
        {"via": None, "program": "JL", "typical_cost": 25000},  # JAL
    ],
}
```

### Enhancement: Positioning Flight Optimization

**Problem**: Sometimes it's cheaper to position to a different airport with better award availability.

**Solution**: Auto-calculate positioning value:

```python
def evaluate_positioning_flights(home_airport, destination, date, points_balance):
    """
    Calculate if positioning to a different origin saves money overall.
    """
    options = []
    
    # Direct from home
    direct_cost = calculate_total_oop(home_airport, destination, date, points_balance)
    options.append(("direct", home_airport, direct_cost))
    
    # Check positioning to major hubs
    POSITIONING_HUBS = ["JFK", "EWR", "ORD", "LAX", "SFO", "MIA", "IAD"]
    
    for hub in POSITIONING_HUBS:
        if hub == home_airport:
            continue
            
        # Cost to position (often cheap on points or budget airlines)
        position_cost = get_positioning_cost(home_airport, hub, date)
        
        # Cost from hub (often better award availability)
        hub_award_cost = calculate_total_oop(hub, destination, date, points_balance)
        
        total = position_cost + hub_award_cost
        
        if total < direct_cost * 0.8:  # Only suggest if 20%+ savings
            options.append(("position", hub, total))
    
    return min(options, key=lambda x: x[2])
```

---

## Strategy 4: Date Flexibility Optimization

### Current Implementation

The Panorama Calendar API provides award availability across dates:

```python
# From award_calendar.py
payload = {
    "origin": "JFK",
    "destination": "CDG",
    "programs": ["UA", "DL", "AA"],
}
# Returns availability heatmap for +/- 30 days
```

### Enhancement: OOP-Optimized Date Selection

**Solution**: Score dates by total OOP, not just award availability:

```python
def find_lowest_oop_dates(origin, destination, target_date, flexibility_days=3):
    """
    Find dates within flexibility window that minimize OOP.
    """
    # Get award calendar
    calendar_data = fetch_panorama_calendar(origin, destination)
    
    # Get cash price calendar (SerpAPI date range search)
    cash_calendar = fetch_cash_price_calendar(origin, destination, target_date, flexibility_days)
    
    date_scores = []
    
    for offset in range(-flexibility_days, flexibility_days + 1):
        check_date = target_date + timedelta(days=offset)
        
        # Best award option for this date
        award_options = calendar_data.get(check_date.isoformat(), [])
        best_award = min(award_options, key=lambda a: a.surcharge) if award_options else None
        
        # Cash price for this date
        cash_price = cash_calendar.get(check_date.isoformat(), float('inf'))
        
        # Calculate OOP for each payment method
        if best_award:
            award_oop = best_award.surcharge  # Just taxes/fees
            award_savings = cash_price - award_oop
        else:
            award_oop = cash_price
            award_savings = 0
        
        date_scores.append({
            "date": check_date,
            "cash_price": cash_price,
            "award_oop": award_oop,
            "savings": award_savings,
            "has_award": best_award is not None,
        })
    
    # Sort by lowest OOP with awards
    return sorted(date_scores, key=lambda d: d["award_oop"])
```

### Enhancement: Multi-Day Trip Optimization

**Problem**: A 3-city trip (JFK → Paris → Rome → JFK) has many date combinations.

**Solution**: Joint optimization across all segments:

```python
def optimize_multi_segment_dates(segments, base_dates, flexibility_days=2):
    """
    Find optimal date combination across multiple segments.
    
    segments: [("JFK", "CDG"), ("CDG", "FCO"), ("FCO", "JFK")]
    base_dates: [date1, date2, date3]
    """
    from itertools import product
    
    # Generate all valid date combinations
    date_ranges = []
    for i, (base_date, segment) in enumerate(zip(base_dates, segments)):
        valid_dates = []
        for offset in range(-flexibility_days, flexibility_days + 1):
            candidate = base_date + timedelta(days=offset)
            # Ensure dates are in order
            valid_dates.append(candidate)
        date_ranges.append(valid_dates)
    
    best_combination = None
    best_oop = float('inf')
    
    for date_combo in product(*date_ranges):
        # Validate: each date must be after previous
        if not is_valid_sequence(date_combo):
            continue
        
        # Calculate total OOP for this combination
        total_oop = 0
        for date, (origin, dest) in zip(date_combo, segments):
            segment_oop = get_best_oop(origin, dest, date)
            total_oop += segment_oop
        
        if total_oop < best_oop:
            best_oop = total_oop
            best_combination = date_combo
    
    return best_combination, best_oop
```

---

## Strategy 5: Credit Card Benefit Stacking

### Current Implementation

The system tracks card benefits for bag savings:

```python
# From objective function
W_benefit × bag_savings
```

### Enhancement: Comprehensive Benefit Integration

**Solution**: Expand benefit tracking:

```python
CARD_BENEFITS = {
    "amex_platinum": {
        "airline_fee_credit": 200,      # Per year
        "hotel_status": "Gold",
        "lounge_access": True,
        "travel_credit": 200,           # Amex Travel
        "uber_credit": 200,             # Per year
        "bag_benefit": None,            # No specific airline
    },
    "chase_sapphire_reserve": {
        "travel_credit": 300,           # Per year
        "priority_pass": True,
        "primary_car_rental": True,
        "trip_delay": 500,              # Per trip
        "bag_benefit": None,
    },
    "united_club_infinite": {
        "bag_benefit": {"UA": 2},       # 2 free bags on United
        "priority_boarding": "UA",
        "lounge_access": "United Club",
        "anniversary_miles": 10000,
    },
    "delta_reserve": {
        "bag_benefit": {"DL": 1},       # 1 free bag on Delta
        "companion_cert": True,
        "lounge_access": "Delta Sky Club",
        "status_boost": "MQD waiver",
    },
}

def calculate_benefit_value(card, itinerary):
    """
    Calculate total benefit value for a card on a specific itinerary.
    """
    benefits = CARD_BENEFITS.get(card, {})
    value = 0
    
    # Bag benefits
    for segment in itinerary.segments:
        airline = segment.operating_carrier
        if benefits.get("bag_benefit", {}).get(airline):
            bags_covered = benefits["bag_benefit"][airline]
            value += bags_covered * 35 * len(itinerary.travelers)  # $35/bag
    
    # Travel credits (if applicable to booking)
    if benefits.get("travel_credit"):
        # Check if credit applies to this purchase
        value += min(benefits["travel_credit"], itinerary.cash_cost)
    
    return value
```

### Enhancement: Payment Card Optimization

**Problem**: Different cards offer different benefits for the same booking.

**Solution**: Recommend optimal payment card:

```python
def recommend_payment_card(itinerary, user_cards):
    """
    Recommend which card to use for each segment to maximize benefits.
    """
    recommendations = []
    
    for segment in itinerary.segments:
        best_card = None
        best_value = 0
        
        for card in user_cards:
            value = 0
            
            # Check bag benefits
            if card_has_bag_benefit(card, segment.airline):
                value += 35 * segment.passengers
            
            # Check earn rates
            earn_rate = get_earn_rate(card, "travel")
            value += segment.cash_cost * earn_rate * 0.01  # CPP value of earned points
            
            # Check travel protections
            if card_has_trip_delay(card):
                value += 10  # Expected value of protection
            
            if value > best_value:
                best_value = value
                best_card = card
        
        recommendations.append({
            "segment": segment,
            "recommended_card": best_card,
            "benefit_value": best_value,
        })
    
    return recommendations
```

---

## Strategy 6: Mixed Cabin Optimization

### Enhancement: Strategic Cabin Selection

**Problem**: Business class awards may provide better CPP value than economy on some routes.

**Solution**: Cross-cabin comparison:

```python
def evaluate_cabin_options(origin, destination, date, points_balance):
    """
    Compare OOP across cabin classes, factoring in comfort value.
    """
    options = []
    
    for cabin in ["Economy", "Premium Economy", "Business", "First"]:
        # Get award availability
        award = search_award(origin, destination, date, cabin)
        cash = search_cash(origin, destination, date, cabin)
        
        if award and cash:
            oop = award.surcharge
            cpp = (cash.price - oop) / award.points * 100
            
            options.append({
                "cabin": cabin,
                "points": award.points,
                "oop": oop,
                "cash_price": cash.price,
                "cpp": cpp,
                "savings": cash.price - oop,
            })
    
    # Sort by savings (not just lowest OOP)
    return sorted(options, key=lambda x: -x["savings"])
```

**Example Output**:
| Cabin | Points | OOP | Cash Price | CPP | Savings |
|-------|--------|-----|------------|-----|---------|
| Business | 70,000 | $150 | $3,500 | 4.79 | $3,350 |
| Economy | 30,000 | $50 | $800 | 2.50 | $750 |

In this case, Business class has higher OOP ($150 vs $50) but **much higher value** (4.79 CPP vs 2.50 CPP) and **higher total savings** ($3,350 vs $750).

---

## Strategy 7: Group Booking Optimization

### Enhancement: Split-Payment Strategy

**Problem**: Limited award seats may mean some travelers must pay cash.

**Solution**: Optimize which travelers use which payment method:

```python
def optimize_group_payment(travelers, flight, award_seats_available, points_balances):
    """
    Determine optimal payment split for a group when award seats are limited.
    """
    cash_price = flight.cash_price
    award_price = flight.award_price
    surcharge = flight.surcharge
    
    # Calculate value per seat
    value_per_award_seat = cash_price - surcharge
    
    # Sort travelers by who should use points (highest balance first)
    travelers_sorted = sorted(
        travelers, 
        key=lambda t: points_balances[t.id], 
        reverse=True
    )
    
    assignments = []
    award_seats_used = 0
    
    for traveler in travelers_sorted:
        if award_seats_used < award_seats_available and \
           points_balances[traveler.id] >= award_price:
            # Assign award seat
            assignments.append({
                "traveler": traveler,
                "payment": "award",
                "points": award_price,
                "oop": surcharge,
            })
            award_seats_used += 1
        else:
            # Assign cash seat
            assignments.append({
                "traveler": traveler,
                "payment": "cash",
                "points": 0,
                "oop": cash_price,
            })
    
    total_oop = sum(a["oop"] for a in assignments)
    total_points = sum(a["points"] for a in assignments)
    
    return {
        "assignments": assignments,
        "total_oop": total_oop,
        "total_points_used": total_points,
        "comparison_all_cash": cash_price * len(travelers),
        "savings": (cash_price * len(travelers)) - total_oop,
    }
```

---

## Implementation Roadmap

### Phase 1: Quick Wins (Existing Infrastructure)

| Feature | Effort | OOP Impact |
|---------|--------|------------|
| Surcharge-aware CPP thresholds | Low | 5-15% |
| Date flexibility scoring | Low | 10-20% |
| Payment card recommendations | Low | 5-10% |

### Phase 2: Enhanced Optimization

| Feature | Effort | OOP Impact |
|---------|--------|------------|
| Partner award integration | Medium | 15-25% |
| Transfer bonus tracking | Medium | 5-15% |
| Multi-day joint optimization | Medium | 10-20% |

### Phase 3: Advanced Features

| Feature | Effort | OOP Impact |
|---------|--------|------------|
| Positioning flight analysis | High | 10-30% |
| Mixed cabin optimization | High | 20-40% |
| Award sweet-spot routing | High | 15-25% |

---

## Success Metrics

### Primary KPIs

1. **Average OOP per trip**: Target 50%+ reduction vs cash-only
2. **Average CPP achieved**: Target >1.5 CPP across all redemptions
3. **Award utilization rate**: % of eligible segments booked with points

### Secondary KPIs

1. **Transfer efficiency**: Average value extracted per transferred point
2. **Surcharge ratio**: Surcharges as % of total OOP
3. **Date flexibility savings**: Additional savings from flexible date selection

---

## Conclusion

By implementing these strategies progressively, Tripy can systematically reduce out-of-pocket costs for users while ensuring they extract maximum value from their points portfolios. The key is treating OOP reduction as a **multi-dimensional optimization problem** that considers not just point costs, but also:

- Surcharges and taxes
- Transfer partner options
- Date flexibility
- Credit card benefits
- Route alternatives
- Cabin class value

Each strategy builds on the existing ILP infrastructure, making implementation incremental and testable.
