# Optimized Itinerary Implementation Plan

## Executive Summary

This document provides a comprehensive implementation plan for creating optimized travel itineraries that intelligently coordinate:
- **Flight bookings** using points or cash
- **Hotel reservations** integrated with flights
- **Ground transportation** decisions (fly vs. bus/car)
- **Points transfer strategies** with specific bank-to-airline instructions

The goal is to **minimize out-of-pocket (OOP) costs** while maximizing the value of available loyalty points.

---

## Table of Contents

1. [System Architecture Overview](#1-system-architecture-overview)
2. [Transportation Mode Selection Logic](#2-transportation-mode-selection-logic)
3. [Hotel Booking Integration](#3-hotel-booking-integration)
4. [Points Transfer Strategy Engine](#4-points-transfer-strategy-engine)
5. [Credit Card Transfer Reference](#5-credit-card-transfer-reference)
6. [ILP Optimization Algorithm](#6-ilp-optimization-algorithm)
7. [Implementation Phases](#7-implementation-phases)
8. [API Endpoints & Data Models](#8-api-endpoints--data-models)
9. [Frontend Components](#9-frontend-components)
10. [Testing Strategy](#10-testing-strategy)
11. [Complete Example Walkthrough](#11-complete-example-walkthrough)

---

## 1. System Architecture Overview

### 1.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              User Input                                          │
│  • Destinations (cities)                                                         │
│  • Travel dates                                                                  │
│  • Number of travelers                                                           │
│  • Points balances (Chase: 150K, Amex: 200K, etc.)                              │
│  • Budget constraints (optional)                                                 │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STEP 1: Data Collection (Parallel)                            │
│                                                                                  │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐              │
│  │  Flight Search   │  │  Ground Transit  │  │   Hotel Search   │              │
│  │  (AwardTool +    │  │  (OpenAI est.)   │  │  (AwardTool +    │              │
│  │   SerpAPI)       │  │  Bus/Car options │  │   SerpAPI)       │              │
│  └──────────────────┘  └──────────────────┘  └──────────────────┘              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STEP 2: Build Unified Cost Graph                              │
│                                                                                  │
│  All transportation + hotel options as graph edges with:                         │
│  • Cash cost                                                                     │
│  • Points cost + surcharge                                                       │
│  • Time duration                                                                 │
│  • Transfer options (which banks can pay for this)                              │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STEP 3: ILP Optimization                                      │
│                                                                                  │
│  Objective: Minimize total out-of-pocket                                         │
│  Subject to: Points balance, transfer rules, budget constraints                  │
└─────────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                    STEP 4: Generate Transfer Instructions                        │
│                                                                                  │
│  Output:                                                                         │
│  • Which credit card program to transfer from                                    │
│  • How many points to transfer                                                   │
│  • Which airline/hotel program to transfer to                                    │
│  • Step-by-step booking instructions                                            │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Key Files

| File | Purpose |
|------|---------|
| `backend/src/handlers/planTrip.py` | ILP optimization algorithm (PuLP) |
| `backend/src/handlers/flights.py` | Flight search (AwardTool + SerpAPI) |
| `backend/src/handlers/ground_transport.py` | Bus/car option estimation |
| `backend/src/handlers/hotels.py` | Hotel search (AwardTool + SerpAPI) |
| `backend/src/services/itinerary_service.py` | Orchestrates full itinerary flow |
| `backend/src/utils/award_programs.py` | Transfer graph configuration |

---

## 2. Transportation Mode Selection Logic

### 2.1 When to Fly vs. Ground Transport

The optimizer **does not hardcode** a transportation preference. Instead, it considers all modes simultaneously and lets the ILP algorithm select the optimal one based on:

| Factor | Weight | Description |
|--------|--------|-------------|
| Cash Cost | High | Total out-of-pocket expense |
| Points Value | High | Cash saved by using points |
| Time Cost | Low | Travel duration (tiebreaker) |

### 2.2 Ground Transport Feasibility Rules

**Location:** `backend/src/handlers/ground_transport.py`

Ground transport (bus/car) is **only suggested** when geographically feasible:

```python
# Geographic Feasibility Rules:
# 1. Same continent (no ocean crossing)
# 2. Land border connection exists
# 3. Not to/from island nations (Japan, UK, Iceland)
# 4. Within distance limits
```

**Distance Limits:**

| Mode | Maximum Distance | Requirements |
|------|------------------|--------------|
| Bus | ~500 miles | Land connection required |
| Car Rental | ~800 miles | Typically same country |

### 2.3 Decision Matrix

| Scenario | Recommendation | Reason |
|----------|---------------|--------|
| NYC → Boston (215 mi) | **Consider Bus** | Short distance, ~$30-50 bus vs $150+ flight |
| NYC → Chicago (790 mi) | **Fly** | Distance too long for bus efficiency |
| NYC → London | **Fly only** | Ocean crossing |
| Paris → Lyon (290 mi) | **Consider Train/Bus** | TGV train often faster than flying |
| LA → San Francisco (382 mi) | **Compare** | Flight ~1h vs Drive ~6h - depends on schedule |

### 2.4 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 2.4.1 | Fetch bus/car options for all route pairs | `ground_transport.py` |
| 2.4.2 | Add ground edges to unified cost graph | `itinerary_service.py` |
| 2.4.3 | Include ground transport in ILP optimization | `planTrip.py` |
| 2.4.4 | Handle small airport hub connections | `itinerary_service.py` |

### 2.5 Small Airport Hub Fallback

For small regional airports without direct flights, the system automatically tries nearby hubs:

```python
SMALL_AIRPORT_NEARBY_HUBS = {
    "ITH": ["SYR", "BUF", "ALB", "EWR", "JFK"],   # Ithaca, NY
    "BGM": ["SYR", "ALB", "EWR", "JFK"],           # Binghamton, NY
    "ELM": ["SYR", "ITH", "BGM", "EWR", "JFK"],   # Elmira, NY
}
```

**Example:** For ITH (Ithaca) to CDG (Paris):
1. No direct flights found from ITH
2. System tries: Ground transport ITH → SYR + Flight SYR → CDG
3. If that fails: Ground transport ITH → JFK + Flight JFK → CDG

---

## 3. Hotel Booking Integration

### 3.1 When Hotels Are Included

Hotels are controlled by the `includeHotels` trip setting (defaults to `True`).

**Conditions for hotel fetching:**

```python
if (
    trip.get("includeHotels", True)    # Must be True
    and destination                     # Must have destination
    and start_date and end_date        # Must have dates
    and travelers                      # Must have travelers
):
    # Fetch hotels
```

### 3.2 Hotel Data Sources

| Source | Data Provided | Points Support |
|--------|---------------|----------------|
| **AwardTool Hotel API** | Cash rates, points costs, surcharges | Yes (Hilton, IHG, Marriott, Hyatt) |
| **SerpAPI Google Hotels** | Cash rates only | No |

### 3.3 Supported Hotel Loyalty Programs

| Code | Program | Transfer Partners |
|------|---------|-------------------|
| `HH` | Hilton Honors | Amex (1:2 bonus!) |
| `IHG` | IHG Rewards | Chase, Bilt |
| `MAR` | Marriott Bonvoy | Amex, Chase |
| `HYATT` | World of Hyatt | Chase (1:1), Bilt (1:1) |

### 3.4 Hotel Cost Impact on Budget

| Setting | Cost per Day | Cost per City |
|---------|--------------|---------------|
| `includeHotels=True` (default) | $200/day | $300/city |
| `includeHotels=False` | $120/day | $200/city |

### 3.5 Hotel Out-of-Pocket Optimization

**Location:** `backend/src/services/serp_api_functions.py`

```python
def optimize_hotels_out_of_pocket():
    """
    Out-of-pocket = min(cash_rate, surcharge) when points available
    Out-of-pocket = cash_rate when no points
    
    Returns: { best_by_cash, best_by_points, best_overall }
    """
```

### 3.6 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 3.6.1 | Fetch hotel options alongside flights | `itinerary_service.py` |
| 3.6.2 | Include hotels in unified cost graph | `trip_cost_optimizer.py` |
| 3.6.3 | Add hotel points options to ILP solver | `min_oop_optimizer.py` |
| 3.6.4 | Generate hotel booking instructions | `transfer_strategy.py` |

---

## 4. Points Transfer Strategy Engine

### 4.1 Core Concept: OOP vs CPP

| Traditional (CPP) | Our Approach (OOP) |
|-------------------|-------------------|
| Maximize cents-per-point value | Minimize total cash paid |
| Skip "low value" redemptions | Use points if it reduces cash |
| Optimize per-segment | Optimize entire trip holistically |
| May leave points unused | Strategically depletes points |

**Example Impact:**
- Trip cost: $2,550 (2 flights + hotel)
- CPP approach: $1,370 OOP (uses points only when CPP ≥ 1.0¢)
- OOP approach: $210 OOP (uses points wherever they eliminate cash)
- **Savings: $1,160 (85% reduction)**

### 4.2 Transfer Decision Algorithm

```python
def rank_transfer_options(
    transfer_options: List[TransferOption],
    user_balances: Dict[str, int],
    preferences: UserPreferences
) -> List[RankedOption]:
    """
    Priority Order:
    1. Sufficient balance (disqualify if insufficient)
    2. Fewest bank points required
    3. Lowest surcharge
    4. Fastest transfer time (if travel is imminent)
    5. User preference (if they prefer certain programs)
    """
```

### 4.3 Transfer Time Considerations

| Bank | Transfer Time | When to Use |
|------|---------------|-------------|
| Chase Ultimate Rewards | **Instant** | Any travel timeline |
| Citi ThankYou | Instant to 24h | Travel in 2+ days |
| Capital One | Instant to 2 days | Travel in 3+ days |
| Amex Membership Rewards | 1-2 business days | Travel in 4+ days |
| Bilt Rewards | **Instant** | Any travel timeline |

### 4.4 AwardTool Transfer Options

AwardTool API returns `transfer_options` field showing which banks can fund each award:

```json
{
  "airline_code": "B6",
  "award_points": 14000,
  "surcharge": 5.6,
  "transfer_options": [
    { "points": 14000, "program": "chase" },
    { "points": 17500, "program": "amex" },
    { "points": 14000, "program": "citi" }
  ]
}
```

This tells us:
- **Chase/Citi**: 14,000 points (1:1 ratio)
- **Amex**: 17,500 points (less efficient - 1:1.25 ratio)

---

## 5. Credit Card Transfer Reference

### 5.1 Bank → Airline Partners

| Bank (Credit Card) | Airlines (1:1 unless noted) | Best Cards |
|-------------------|----------------------------|------------|
| **Chase Ultimate Rewards** | United, Southwest, British Airways, Air France/KLM, Iberia, Singapore, Virgin Atlantic, Aer Lingus, JetBlue, Alaska | Sapphire Reserve, Sapphire Preferred, Ink Preferred |
| **Amex Membership Rewards** | Delta, JetBlue (1:0.8), ANA, Singapore, Cathay, British Airways, Air France, Emirates, Etihad, Virgin Atlantic, Qantas, Avianca, Iberia, Air Canada, Alaska | Platinum, Gold, Business Platinum |
| **Citi ThankYou Points** | American Airlines, JetBlue, Singapore, Cathay, Qatar, Emirates, Etihad, Turkish, Avianca, Air France, Thai, EVA, Virgin Atlantic, Japan Airlines, Air Canada | Premier, Prestige, Custom Cash |
| **Capital One Miles** | Air Canada, Air France, British Airways (1:0.75), Emirates, Etihad, Finnair, Singapore, Turkish, Avianca, Qantas, TAP, Cathay, Alaska | Venture X, Venture, Spark Miles |
| **Bilt Rewards** | United, American, British Airways, Air France, Turkish, Emirates, Virgin Atlantic, Aer Lingus, Air Canada, Iberia, Cathay, Alaska | Bilt Mastercard |

### 5.2 Bank → Hotel Partners

| Bank | Hotels | Transfer Ratio | Best For |
|------|--------|----------------|----------|
| **Chase UR** | Hyatt | 1:1 | Excellent value - Hyatt points worth ~2¢ |
| **Chase UR** | Marriott | 1:1 | Good for large redemptions |
| **Chase UR** | IHG | 1:1 | Good for mid-tier properties |
| **Amex MR** | Hilton | **1:2** | Double your points! |
| **Amex MR** | Marriott | 1:1 | Flexible redemptions |
| **Capital One** | Accor | 1:1 | Europe-focused |
| **Capital One** | Wyndham | 1:1 | Budget properties |
| **Bilt Rewards** | Hyatt | 1:1 | Premium value |
| **Bilt Rewards** | IHG | 1:1 | Good mid-tier |

### 5.3 Transfer Portal URLs

| Bank | Transfer Portal URL |
|------|---------------------|
| Chase Ultimate Rewards | https://ultimaterewardspoints.chase.com |
| Amex Membership Rewards | https://global.americanexpress.com/rewards |
| Citi ThankYou Points | https://thankyou.citi.com |
| Capital One Miles | https://www.capitalone.com/credit-cards/benefits/travel/ |
| Bilt Rewards | https://www.biltrewards.com |

### 5.4 High-Value Transfer Recommendations

| Scenario | Recommended Transfer | Why |
|----------|---------------------|-----|
| US Domestic Economy | Chase → United | 1:1 ratio, no fuel surcharges |
| US Domestic Economy | Bilt → American | 1:1 ratio, good saver availability |
| Transatlantic Business | Chase → Air France | Low surcharges via Flying Blue |
| Transatlantic Business | Amex → Delta | SkyMiles occasionally has deals |
| Asia Business Class | Amex → ANA | Outstanding value (50K-95K roundtrip) |
| Asia Business Class | Chase → Singapore | World-class product |
| Middle East Premium | Chase → Emirates | Excellent availability |
| Hotel (Luxury) | Chase → Hyatt | Best CPP value in hotels |
| Hotel (Volume) | Amex → Hilton (1:2) | Double points stretch budget |

---

## 6. ILP Optimization Algorithm

### 6.1 Objective Function

**Location:** `backend/src/handlers/planTrip.py`

The optimizer **minimizes out-of-pocket cost**:

```
Minimize:
    Σ (cash_paid_for_item[i])
    
Where for each item i:
    cash_paid_for_item[i] = {
        cash_cost[i]       if pay_cash[i] = 1
        surcharge[i][p]    if use_points[i][p] = 1 for program p
    }
```

### 6.2 Decision Variables

| Variable | Type | Description |
|----------|------|-------------|
| `pay_cash[i]` | Binary | 1 if item i paid with cash |
| `use_points[i,p]` | Binary | 1 if item i paid via program p |
| `transfer[b,p]` | Integer | Points transferred from bank b to program p |

### 6.3 Constraints

| Constraint | Description |
|------------|-------------|
| **Payment** | Each item paid exactly once (cash OR one points program) |
| **Points Balance** | Don't exceed available points (native + transferred) |
| **Transfer Limit** | Don't transfer more than bank balance |
| **Transfer Validity** | Only transfer to valid partners |
| **Budget** | Total cash ≤ budget (optional) |

### 6.4 ILP Solver Implementation

```python
def minimize_out_of_pocket(
    items: List[TripCostItem],
    available_points: Dict[str, int],
    transfer_graph: Dict[str, Dict[str, float]],
) -> MinOOPSolution:
    """
    Solve ILP to find minimum out-of-pocket payment strategy.
    
    Args:
        items: All bookable items (flights + hotels)
        available_points: User's point balances by program
        transfer_graph: Which banks can transfer to which programs
        
    Returns:
        MinOOPSolution with:
        - payment_plan: How to pay for each item
        - transfer_plan: Which points to transfer where
        - total_out_of_pocket: Final cash cost
    """
    import pulp as pl
    
    prob = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
    
    # Identify banks vs airline/hotel programs
    banks = [k for k in available_points if k.islower()]
    programs = set()
    for item in items:
        for opt in item.points_options:
            programs.add(opt["program"])
    
    # Decision variables
    pay_cash = {item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary") 
                for item in items}
    
    use_points = {
        (item.item_id, opt["program"]): pl.LpVariable(
            f"pts_{item.item_id}_{opt['program']}", cat="Binary")
        for item in items
        for opt in item.points_options
    }
    
    transfer = {
        (bank, prog): pl.LpVariable(f"xfer_{bank}_{prog}", lowBound=0, cat="Integer")
        for bank in banks
        for prog in programs
        if prog in transfer_graph.get(bank, [])
    }
    
    # Objective: Minimize OOP
    prob += (
        pl.lpSum(pay_cash[item.item_id] * item.cash_cost for item in items) +
        pl.lpSum(
            use_points[(item.item_id, opt["program"])] * opt["surcharge"]
            for item in items
            for opt in item.points_options
        )
    )
    
    # Constraints...
    prob.solve(pl.PULP_CBC_CMD(msg=False))
    
    return _extract_solution(prob, items, pay_cash, use_points, transfer)
```

---

## 7. Implementation Phases

### Phase 1: Foundation (Transfer Graph & Metadata)

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 1.1 | Create `EXTENDED_TRANSFER_GRAPH` (banks → airlines + hotels) | Critical | Low |
| 1.2 | Create `BANK_TRANSFER_METADATA` (portal URLs, times, cards) | Critical | Low |
| 1.3 | Implement `rank_transfer_options()` function | Critical | Medium |
| 1.4 | Add transfer instructions generator | High | Medium |
| 1.5 | Extract `transfer_options` from AwardTool responses | High | Low |

**Deliverable:** System knows which banks transfer to which programs

### Phase 2: Unified Cost Aggregation

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 2.1 | Define `TripCostItem` dataclass (flights + hotels) | Critical | Low |
| 2.2 | Implement `aggregate_trip_costs()` function | Critical | Medium |
| 2.3 | Add hotel points options to cost graph | High | Medium |
| 2.4 | Include ground transport in cost graph | Medium | Medium |

**Deliverable:** Single unified view of all trip costs

### Phase 3: ILP Optimization Engine

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 3.1 | Define `MinOOPSolution` and related dataclasses | Critical | Low |
| 3.2 | Implement `minimize_out_of_pocket()` ILP solver | Critical | High |
| 3.3 | Add transfer consolidation logic | Medium | Low |
| 3.4 | Handle edge cases (insufficient points, infeasible) | High | Medium |

**Deliverable:** Automatic optimal points allocation

### Phase 4: API Endpoints

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 4.1 | Implement `/api/trip/optimize-out-of-pocket` endpoint | Critical | Medium |
| 4.2 | Implement `/api/transfers/simulate` endpoint | Medium | Low |
| 4.3 | Update itinerary response to include transfer_plan | High | Medium |

**Deliverable:** Backend APIs ready for frontend

### Phase 5: Frontend Experience

| Task | Description | Priority | Effort |
|------|-------------|----------|--------|
| 5.1 | Create `TransferStrategyCard` component | High | Medium |
| 5.2 | Create `PaymentBreakdown` component | High | Medium |
| 5.3 | Add "Copy to Clipboard" for transfer amounts | Medium | Low |
| 5.4 | Create savings comparison visualization | Medium | Medium |

**Deliverable:** Beautiful, actionable UI

---

## 8. API Endpoints & Data Models

### 8.1 Main Endpoint: Optimize Trip

```
POST /api/trip/optimize-out-of-pocket
```

**Request:**
```json
{
  "trip_id": "abc123",
  "include_hotels": true,
  "points_override": null,
  "max_cash_budget": null
}
```

**Response:**
```json
{
  "status": "Optimal",
  "summary": {
    "total_out_of_pocket": 210.00,
    "all_cash_cost": 2550.00,
    "savings": 2340.00,
    "savings_percentage": 91.8,
    "total_points_used": 315000
  },
  "transfers": [
    {
      "from_bank": "chase",
      "from_bank_name": "Chase Ultimate Rewards",
      "to_program": "AF",
      "to_program_name": "Air France Flying Blue",
      "points_to_transfer": 60000,
      "transfer_ratio_display": "1:1",
      "transfer_time": "instant",
      "portal_url": "https://ultimaterewardspoints.chase.com",
      "steps": [
        "1. Log in to Chase Ultimate Rewards",
        "2. Click 'Transfer Points'",
        "3. Select 'Air France Flying Blue'",
        "4. Enter 60,000 points",
        "5. Confirm transfer"
      ],
      "for_items": ["flight_jfk_cdg"]
    }
  ],
  "payments": [
    {
      "item_id": "flight_jfk_cdg",
      "item_type": "flight",
      "description": "JFK → CDG on Air France",
      "payment_type": "points",
      "cash_paid": 120.00,
      "points_used": 60000,
      "program_used": "Air France Flying Blue",
      "booking_url": "https://www.airfrance.com/..."
    }
  ],
  "points_by_program": {
    "Air France Flying Blue": 115000,
    "Hilton Honors": 200000
  }
}
```

### 8.2 Data Models

```python
@dataclass
class TripCostItem:
    item_id: str
    item_type: Literal["flight", "hotel"]
    description: str
    cash_cost: float
    points_options: List[PointsOption]
    
@dataclass
class PointsOption:
    program_code: str
    points_required: int
    surcharge: float
    transfer_options: List[TransferOption]

@dataclass
class TransferInstruction:
    from_bank: str
    from_bank_name: str
    to_program: str
    to_program_name: str
    points_to_transfer: int
    transfer_ratio_display: str
    transfer_time: str
    portal_url: str
    steps: List[str]
    for_items: List[str]

@dataclass
class PaymentInstruction:
    item_id: str
    item_type: str
    description: str
    payment_type: Literal["cash", "points"]
    cash_paid: float
    points_used: Optional[int]
    program_used: Optional[str]
    booking_url: Optional[str]
```

---

## 9. Frontend Components

### 9.1 Transfer Strategy Display

```tsx
// TransferStrategy.tsx
export function TransferStrategy({ solution }: { solution: OptimizationResult }) {
  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Your Optimized Payment Strategy</CardTitle>
          <CardDescription>
            Save ${solution.savings.toFixed(2)} ({solution.savings_percentage}%)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Out of Pocket" value={`$${solution.total_out_of_pocket}`} />
            <Stat label="Points Used" value={solution.total_points_used.toLocaleString()} />
            <Stat label="vs. All Cash" value={`$${solution.all_cash_cost}`} crossed />
          </div>
        </CardContent>
      </Card>
      
      {/* Step 1: Transfers */}
      <Card>
        <CardHeader>
          <CardTitle>Step 1: Transfer Your Points</CardTitle>
        </CardHeader>
        <CardContent>
          {solution.transfers.map((transfer, i) => (
            <TransferCard key={i} transfer={transfer} index={i + 1} />
          ))}
        </CardContent>
      </Card>
      
      {/* Step 2: Bookings */}
      <Card>
        <CardHeader>
          <CardTitle>Step 2: Book Your Trip</CardTitle>
        </CardHeader>
        <CardContent>
          {solution.payments.map((payment, i) => (
            <PaymentCard key={i} payment={payment} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 9.2 Transfer Instruction Card

```tsx
// TransferCard.tsx
export function TransferCard({ transfer, index }: { transfer: TransferInstruction; index: number }) {
  return (
    <div className="border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Badge variant="outline">{index}</Badge>
          <div>
            <p className="font-medium">
              {transfer.from_bank_name} → {transfer.to_program_name}
            </p>
            <p className="text-sm text-muted-foreground">
              Transfer {transfer.points_to_transfer.toLocaleString()} points
            </p>
          </div>
        </div>
        <Badge>{transfer.transfer_time}</Badge>
      </div>
      
      <Accordion>
        <AccordionItem value="steps">
          <AccordionTrigger>Step-by-step instructions</AccordionTrigger>
          <AccordionContent>
            <ol className="list-decimal ml-4 space-y-1">
              {transfer.steps.map((step, i) => (
                <li key={i}>{step}</li>
              ))}
            </ol>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
      
      <Button asChild className="mt-2">
        <a href={transfer.portal_url} target="_blank">
          Open {transfer.from_bank_name} Portal
        </a>
      </Button>
    </div>
  );
}
```

---

## 10. Testing Strategy

### 10.1 Unit Test Scenarios

| Scenario | Setup | Expected Outcome |
|----------|-------|------------------|
| **Single Flight** | 100K Chase, JFK→CDG (60K miles + $120) | Transfer 60K, OOP = $120 |
| **Flight + Hotel** | 200K Amex, Flight + 5-night Hilton | Use both, OOP = surcharges |
| **Insufficient Points** | 30K points, need 80K | Pay cash for one item |
| **Multi-Bank Split** | 50K each bank, need 150K total | Transfer from multiple banks |
| **Ground vs Flight** | NYC→BOS, points available | Compare OOP for bus vs flight |
| **No Points** | 0 points | Pay cash for everything |

### 10.2 Integration Test Example

```python
async def test_full_optimization_flow():
    # User with 200K Amex, 100K Chase
    user_points = {"amex": 200000, "chase": 100000}
    
    # Trip: JFK → CDG → JFK with 3 nights hotel
    trip = create_test_trip(
        destinations=[("JFK", "CDG")],
        start_date="2026-06-01",
        end_date="2026-06-04"
    )
    
    result = await optimize_trip_out_of_pocket(trip.id, user_points)
    
    assert result.status == "Optimal"
    assert result.total_out_of_pocket < 500  # Mostly surcharges
    assert len(result.transfers) >= 1
    assert result.savings > 0
```

---

## 11. Complete Example Walkthrough

### Scenario

**User Points:**
- Chase Ultimate Rewards: 150,000
- Amex Membership Rewards: 200,000
- United MileagePlus: 25,000 (native airline miles)

**Trip:** JFK → Paris → Rome → JFK (10 days)

### Step 1: System Searches (Parallel)

| Segment | Cash Option | Points Options |
|---------|-------------|----------------|
| JFK → CDG | $850 | Air France: 55K + $120 surcharge |
| CDG → FCO | $180 | ITA: 15K + $30 surcharge |
| FCO → JFK | $900 | United: 60K + $50 surcharge |
| Paris Hotel (4 nights) | $800 | Hilton: 160K + $40 surcharge |
| Rome Hotel (4 nights) | $600 | Hyatt: 80K + $30 surcharge |

**All Cash Total:** $3,330

### Step 2: Build Transfer Paths

| Award | Bank Options | Best Choice |
|-------|--------------|-------------|
| Air France 55K | Chase (1:1), Amex (1:1) | **Chase** (instant transfer) |
| ITA 15K | Cash (no partner awards) | **Pay Cash** |
| United 60K | Chase (1:1), Bilt (1:1) | **Chase** (35K) + Native (25K) |
| Hilton 160K | Amex (1:2 = 80K MR needed) | **Amex** |
| Hyatt 80K | Chase (1:1) | **Chase** (60K already used for flights) → **Bilt or Cash** |

### Step 3: ILP Optimization Result

**Optimal Solution:**

| Item | Payment | Cash Paid | Points Used |
|------|---------|-----------|-------------|
| JFK → CDG | Air France Miles | $120 | 55,000 (from Chase) |
| CDG → FCO | **Cash** | $180 | - |
| FCO → JFK | United Miles | $50 | 60,000 (25K native + 35K Chase) |
| Paris Hotel | Hilton Points | $40 | 160,000 (80K Amex → 160K Hilton) |
| Rome Hotel | Hyatt Points | $30 | 80,000 (need additional source) |

### Step 4: Final Transfer Instructions

```
═══════════════════════════════════════════════════════════════════
                    YOUR OPTIMIZED TRIP
═══════════════════════════════════════════════════════════════════

TOTAL OUT-OF-POCKET: $420
vs. All Cash: $3,330
YOU SAVE: $2,910 (87%)

═══════════════════════════════════════════════════════════════════
                  STEP 1: TRANSFER YOUR POINTS
═══════════════════════════════════════════════════════════════════

① CHASE ULTIMATE REWARDS → AIR FRANCE FLYING BLUE
   Transfer: 55,000 points
   Time: Instant
   For: JFK → Paris flight
   
   Instructions:
   1. Go to ultimaterewardspoints.chase.com
   2. Click "Transfer Points" → "Travel Partners"
   3. Select "Air France / KLM Flying Blue"
   4. Enter your Flying Blue member number
   5. Transfer exactly 55,000 points
   6. Confirm (transfers instantly!)

② CHASE ULTIMATE REWARDS → UNITED MILEAGEPLUS
   Transfer: 35,000 points
   Time: Instant
   For: Rome → JFK flight (combined with your existing 25K United miles)
   
   Instructions:
   1. Still in Chase portal
   2. Select "United MileagePlus"
   3. Transfer 35,000 points
   4. Confirm

③ AMEX MEMBERSHIP REWARDS → HILTON HONORS
   Transfer: 80,000 points → 160,000 Hilton points (2x bonus!)
   Time: 1-2 business days
   For: Paris hotel (4 nights)
   
   Instructions:
   1. Go to global.americanexpress.com/rewards
   2. Click "Transfer Points"
   3. Select "Hilton Honors" (note: 1:2 ratio - you get DOUBLE!)
   4. Transfer 80,000 MR → receive 160,000 Hilton points
   5. Wait 1-2 days before booking hotel

═══════════════════════════════════════════════════════════════════
                    STEP 2: BOOK YOUR TRIP
═══════════════════════════════════════════════════════════════════

✈ JFK → CDG (Paris) - Air France
  55,000 Flying Blue miles + $120 taxes
  → Book at airfrance.com using your Flying Blue account
  
💵 CDG → FCO (Rome) - ITA Airways
  Pay $180 cash
  → Book at ita-airways.com or Google Flights
  
✈ FCO → JFK - United
  60,000 MileagePlus miles + $50 taxes
  → Book at united.com (uses 25K existing + 35K transferred)

🏨 Paris Hotel - Hilton Paris Opera (4 nights)
  160,000 Hilton Honors points + $40 fees
  → Book at hilton.com

🏨 Rome Hotel - Book with remaining budget
  Pay $80 cash (or use 80K Hyatt if transferred)
  
═══════════════════════════════════════════════════════════════════
                        SUMMARY
═══════════════════════════════════════════════════════════════════

Points Transferred:
• Chase → Air France:  55,000
• Chase → United:      35,000
• Amex → Hilton:       80,000 → 160,000

Cash Payments:
• Air France surcharge: $120
• ITA Airways cash:     $180
• United surcharge:     $50
• Hilton fees:          $40
• Rome accommodation:   $30
────────────────────────
TOTAL OUT-OF-POCKET:    $420

Remaining Balances:
• Chase UR: 60,000 points
• Amex MR: 120,000 points
• United: 0 miles
```

---

## Appendix A: Complete Transfer Graph Reference

### Bank → Airline Transfer Matrix

| Airline | Chase | Amex | Citi | Capital One | Bilt |
|---------|-------|------|------|-------------|------|
| United (UA) | ✓ 1:1 | - | - | - | ✓ 1:1 |
| American (AA) | - | - | ✓ 1:1 | - | ✓ 1:1 |
| Delta (DL) | - | ✓ 1:1 | - | - | - |
| Air France (AF) | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| British Airways (BA) | ✓ 1:1 | ✓ 1:1 | - | ✓ 0.75:1 | ✓ 1:1 |
| Singapore (SQ) | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | - |
| Emirates (EK) | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| Virgin Atlantic (VS) | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 | ✓ 1:1 |
| Alaska (AS) | ✓ 1:1 | ✓ 1:1 | - | ✓ 1:1 | ✓ 1:1 |
| JetBlue (B6) | ✓ 1:1 | ✓ 0.8:1 | ✓ 1:1 | - | - |

### Bank → Hotel Transfer Matrix

| Hotel | Chase | Amex | Capital One | Bilt |
|-------|-------|------|-------------|------|
| Hyatt | ✓ 1:1 | - | - | ✓ 1:1 |
| Marriott | ✓ 1:1 | ✓ 1:1 | - | - |
| Hilton | - | ✓ 1:2 | - | - |
| IHG | ✓ 1:1 | - | - | ✓ 1:1 |
| Accor | - | - | ✓ 1:1 | - |
| Wyndham | - | - | ✓ 1:1 | - |

---

## Appendix B: High-Surcharge Airline Strategies

Some airlines have very high fuel surcharges on award tickets. Use these workarounds:

| Airline | Typical Surcharge | Partner Workaround | Surcharge via Partner |
|---------|-------------------|-------------------|----------------------|
| British Airways | $500-800+ | Book via American or Alaska | ~$50 |
| Lufthansa | $300-600 | Book via United | ~$30 |
| Singapore | $200-400 | Book via United or Aeroplan | ~$30 |
| Air France | $200-350 | Book via Delta | ~$50 |
| KLM | $200-350 | Book via Delta | ~$50 |

**Recommendation:** When transferring to a high-surcharge program, check if a partner program can book the same flight with lower surcharges.

---

*Document Version: 1.0*
*Created: January 2026*
*Based on Tripy Backend Architecture and AwardTool API Documentation*
