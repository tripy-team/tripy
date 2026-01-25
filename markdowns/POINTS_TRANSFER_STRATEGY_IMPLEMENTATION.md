# Points Transfer Strategy Implementation Plan

## Goal

Create a **holistic points allocation strategy** that minimizes total out-of-pocket costs across an entire trip (flights + hotels) rather than optimizing for cents-per-point (CPP) value.

### Key Difference from Current Approach

| Current Approach | New Approach |
|------------------|--------------|
| Maximizes CPP (value per point) | Minimizes total cash paid |
| Uses points only when CPP ≥ threshold | Uses points to eliminate cash costs |
| Optimizes flights and hotels separately | Joint optimization across all expenses |
| May leave points unused if CPP is "low" | Exhausts available points strategically |

**Example:**
- Available: 1,000,000 Amex points
- Flight: 20,000 points + $50 surcharge (cash alternative: $400)
- Hotel: 50,000 points + $20 surcharge (cash alternative: $200)
- **CPP approach**: Uses points for flight (1.75¢) but not hotel (0.36¢) → $220 out-of-pocket
- **New approach**: Uses points for both → $70 out-of-pocket (saves $150)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         New Components (Shaded)                              │
└─────────────────────────────────────────────────────────────────────────────┘

                              User Request
                                   │
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                   │
│              ▓   Holistic Trip Cost Optimizer (NEW)    ▓                   │
│              ▓   src/handlers/trip_cost_optimizer.py   ▓                   │
│              ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓                   │
│                    │                        │                               │
│         ┌──────────┴────────┐    ┌──────────┴────────┐                     │
│         ▼                   ▼    ▼                   ▼                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────────────┐          │
│  │  flights.py │     │  hotels.py  │     │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │          │
│  │  (existing) │     │  (existing) │     │ ▓ transfer_        │          │
│  └──────┬──────┘     └──────┬──────┘     │ ▓ strategy.py (NEW)│          │
│         │                   │            │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │          │
│         ▼                   ▼            └──────────┬──────────┘          │
│  ┌─────────────────────────────────────┐            │                     │
│  │        Unified Cost Graph            │◀───────────┘                     │
│  │   (flights + hotels + transfers)     │                                  │
│  └─────────────────────┬───────────────┘                                  │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────┐          │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │          │
│  │  ▓ Minimum Out-of-Pocket ILP Solver (NEW)               ▓   │          │
│  │  ▓ src/handlers/min_oop_optimizer.py                    ▓   │          │
│  │  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │          │
│  └─────────────────────────────────────────────────────────────┘          │
│                        │                                                   │
│                        ▼                                                   │
│  ┌─────────────────────────────────────────────────────────────┐          │
│  │              Optimal Transfer Plan Output                    │          │
│  │  - Which points to transfer where                           │          │
│  │  - Step-by-step booking instructions                        │          │
│  │  - Total out-of-pocket breakdown                            │          │
│  └─────────────────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Phase 1: Unified Transfer Graph (Hotels + Airlines)

### 1.1 Extend Transfer Graph Schema

**File:** `src/handlers/transfer_strategy.py` (NEW)

Currently, `DEFAULT_TRANSFER_GRAPH` only maps banks → airlines. Extend to include hotel programs:

```python
# Current (airlines only)
DEFAULT_TRANSFER_GRAPH = {
    "amex": {"UA": 1.0, "AA": 1.0, "DL": 1.0, ...},
    "chase": {"UA": 1.0, "BA": 1.0, ...},
}

# Extended (airlines + hotels)
EXTENDED_TRANSFER_GRAPH = {
    "amex": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline"},
        "AA": {"ratio": 1.0, "type": "airline"},
        "DL": {"ratio": 1.0, "type": "airline"},
        "AF": {"ratio": 1.0, "type": "airline"},
        # Hotels
        "HH": {"ratio": 1.0, "type": "hotel"},  # Hilton Honors
        "MAR": {"ratio": 1.0, "type": "hotel"},  # Marriott Bonvoy
    },
    "chase": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline"},
        "BA": {"ratio": 1.0, "type": "airline"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel"},  # World of Hyatt (1:1)
        "MAR": {"ratio": 1.0, "type": "hotel"},
        "IHG": {"ratio": 1.0, "type": "hotel"},
    },
    "capitalone": {
        # Hotels only (no airline transfers)
        "ACC": {"ratio": 1.0, "type": "hotel"},  # Accor
        "WYNDHAM": {"ratio": 1.0, "type": "hotel"},
    },
    "bilt": {
        # Airlines
        "UA": {"ratio": 1.0, "type": "airline"},
        "AA": {"ratio": 1.0, "type": "airline"},
        # Hotels
        "HYATT": {"ratio": 1.0, "type": "hotel"},
        "IHG": {"ratio": 1.0, "type": "hotel"},
    },
}
```

### 1.2 Bank-to-Program Compatibility Matrix

**Data Structure:**

```python
TRANSFER_METADATA = {
    ("amex", "HH"): {
        "ratio": 1.0,           # 1 MR point = 1 Hilton point
        "bonus_ratio": 2.0,     # During promos: 1 MR = 2 Hilton (optional)
        "transfer_time": "instant",
        "minimum": 1000,
        "block_size": 1000,
        "portal_url": "https://global.americanexpress.com/rewards",
    },
    ("chase", "HYATT"): {
        "ratio": 1.0,
        "transfer_time": "instant",
        "minimum": 1000,
        "block_size": 1000,
        "portal_url": "https://ultimaterewardspoints.chase.com",
    },
    # ... more mappings
}
```

### 1.3 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 1.3.1 | Create `EXTENDED_TRANSFER_GRAPH` constant | `src/handlers/transfer_strategy.py` |
| 1.3.2 | Create `TRANSFER_METADATA` dictionary | `src/handlers/transfer_strategy.py` |
| 1.3.3 | Add helper functions: `get_transfer_partners()`, `can_transfer()` | `src/handlers/transfer_strategy.py` |
| 1.3.4 | Add validation for transfer graph consistency | `src/handlers/transfer_strategy.py` |
| 1.3.5 | Unit tests for transfer graph operations | `tests/test_transfer_strategy.py` |

---

## Phase 2: Unified Cost Aggregation

### 2.1 Trip Cost Item Schema

**File:** `src/handlers/trip_cost_optimizer.py` (NEW)

Define a unified schema for all trip expenses:

```python
@dataclass
class TripCostItem:
    """Represents a single bookable item (flight segment or hotel night)."""
    item_id: str
    item_type: Literal["flight", "hotel"]
    
    # Cash payment option
    cash_cost: float
    
    # Points payment options (can have multiple)
    points_options: List[PointsOption]
    
    # Metadata
    origin: Optional[str] = None      # For flights
    destination: Optional[str] = None # For flights
    date: Optional[str] = None
    nights: Optional[int] = None      # For hotels
    
@dataclass
class PointsOption:
    """A way to pay for an item using points."""
    program_code: str           # "UA", "HH", "HYATT", etc.
    program_type: Literal["airline", "hotel"]
    points_required: int
    surcharge: float            # Cash still required (taxes/fees)
    
    # Transfer info (if points come from bank)
    transfer_from: Optional[str] = None  # "amex", "chase", etc.
    transfer_ratio: float = 1.0
```

### 2.2 Cost Aggregation Function

```python
async def aggregate_trip_costs(
    trip_id: str,
    user_points: Dict[str, int],  # {"amex": 1000000, "chase": 150000, "UA": 50000}
) -> TripCostSummary:
    """
    Fetch all flight and hotel options for a trip, normalize into TripCostItems.
    
    Returns:
        TripCostSummary with:
        - all_items: List[TripCostItem]
        - available_points: Dict[str, int]
        - transfer_options: Dict[str, List[str]]  # bank -> [programs]
    """
    # 1. Get trip destinations and dates
    trip = await trip_service.get_trip(trip_id)
    destinations = await destination_service.list_destinations(trip_id)
    
    # 2. Fetch flight options (parallel)
    flight_items = await _fetch_flight_options(destinations, user_points)
    
    # 3. Fetch hotel options (parallel)
    hotel_items = await _fetch_hotel_options(destinations, user_points)
    
    # 4. Build transfer options from user's bank points
    transfer_options = _compute_transfer_options(user_points)
    
    return TripCostSummary(
        all_items=flight_items + hotel_items,
        available_points=user_points,
        transfer_options=transfer_options,
    )
```

### 2.3 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 2.3.1 | Define `TripCostItem` and `PointsOption` dataclasses | `src/handlers/trip_cost_optimizer.py` |
| 2.3.2 | Implement `aggregate_trip_costs()` async function | `src/handlers/trip_cost_optimizer.py` |
| 2.3.3 | Add `_fetch_flight_options()` helper (wraps existing flights.py) | `src/handlers/trip_cost_optimizer.py` |
| 2.3.4 | Add `_fetch_hotel_options()` helper (wraps existing hotels.py) | `src/handlers/trip_cost_optimizer.py` |
| 2.3.5 | Add `_compute_transfer_options()` from user points | `src/handlers/trip_cost_optimizer.py` |

---

## Phase 3: Minimum Out-of-Pocket ILP Solver

### 3.1 Problem Formulation

**Objective:** Minimize total cash paid (out-of-pocket)

```
Minimize:
    Σ (cash_paid_for_item[i])
    
Where for each item i:
    cash_paid_for_item[i] = {
        cash_cost[i]       if pay_cash[i] = 1
        surcharge[i][p]    if use_points[i][p] = 1 for program p
    }
```

**Subject to:**

```
1. Payment Constraint: Each item paid exactly once
   ∀i: pay_cash[i] + Σp use_points[i][p] = 1

2. Points Balance Constraint: Don't exceed available points
   ∀ program p: Σi (use_points[i][p] × points_required[i][p]) ≤ balance[p]

3. Transfer Constraint: Bank points can only be used after transfer
   ∀ bank b, program p:
     transferred[b][p] × ratio[b][p] ≥ Σi (use_points[i][p] × points_required[i][p])
     transferred[b][p] ≤ balance[b]

4. Transfer Once Constraint: Each bank point transferred to at most one program
   ∀ bank b: Σp transferred[b][p] ≤ balance[b]

5. (Optional) Minimum Points Usage: Use at least X% of available points
   Σ points_used ≥ min_usage_pct × total_points
```

### 3.2 Key Difference from Current ILP

| Aspect | Current (`points_maximizer.py`) | New (`min_oop_optimizer.py`) |
|--------|--------------------------------|------------------------------|
| **Objective** | Maximize W1×points_value - W2×cash | Minimize cash_paid |
| **Points Value** | CPP threshold (≥1.0¢) | No threshold, use if reduces OOP |
| **Scope** | Flights only | Flights + Hotels |
| **Transfer** | Implicit in path optimization | Explicit decision variable |
| **Output** | Path + payment breakdown | Transfer instructions + booking order |

### 3.3 Solver Implementation

**File:** `src/handlers/min_oop_optimizer.py` (NEW)

```python
def minimize_out_of_pocket(
    items: List[TripCostItem],
    available_points: Dict[str, int],
    transfer_graph: Dict[str, Dict[str, float]],
    *,
    min_points_usage_pct: float = 0.0,  # 0 = use only if beneficial
    max_cash_budget: Optional[float] = None,
) -> MinOOPSolution:
    """
    Solve ILP to minimize total out-of-pocket cost.
    
    Args:
        items: All bookable items (flights + hotels)
        available_points: User's point balances by program
        transfer_graph: Which banks can transfer to which programs
        min_points_usage_pct: Force minimum point utilization (0-1)
        max_cash_budget: Optional hard budget constraint
        
    Returns:
        MinOOPSolution with:
        - payment_plan: How to pay for each item
        - transfer_plan: Which points to transfer where
        - total_out_of_pocket: Final cash cost
        - points_used: Breakdown by program
    """
    import pulp as pl
    
    m = pl.LpProblem("MinimizeOutOfPocket", pl.LpMinimize)
    
    # Decision variables
    pay_cash = {item.item_id: pl.LpVariable(f"cash_{item.item_id}", cat="Binary") 
                for item in items}
    
    use_points = {
        (item.item_id, opt.program_code): pl.LpVariable(
            f"pts_{item.item_id}_{opt.program_code}", cat="Binary"
        )
        for item in items
        for opt in item.points_options
    }
    
    # Transfer variables: points transferred from bank to program
    banks = [k for k in available_points if k.islower()]  # amex, chase, etc.
    programs = set()
    for item in items:
        for opt in item.points_options:
            programs.add(opt.program_code)
    
    transfer = {
        (bank, prog): pl.LpVariable(f"xfer_{bank}_{prog}", lowBound=0, cat="Integer")
        for bank in banks
        for prog in programs
        if prog in transfer_graph.get(bank, {})
    }
    
    # Objective: Minimize total out-of-pocket
    obj = pl.lpSum(
        pay_cash[item.item_id] * item.cash_cost
        for item in items
    ) + pl.lpSum(
        use_points[(item.item_id, opt.program_code)] * opt.surcharge
        for item in items
        for opt in item.points_options
    )
    m += obj
    
    # Constraints...
    # (See full implementation in code)
    
    m.solve(pl.PULP_CBC_CMD(msg=False))
    
    return _extract_solution(m, items, pay_cash, use_points, transfer)
```

### 3.4 Solution Output Schema

```python
@dataclass
class MinOOPSolution:
    status: str  # "Optimal", "Infeasible", etc.
    
    # Payment plan: how to pay for each item
    payment_plan: List[PaymentInstruction]
    
    # Transfer plan: which points to move where
    transfer_plan: List[TransferInstruction]
    
    # Summary
    total_out_of_pocket: float
    total_points_used: int
    points_breakdown: Dict[str, int]  # program -> points used
    
    # Comparison to all-cash
    all_cash_cost: float
    savings: float
    
@dataclass
class PaymentInstruction:
    item_id: str
    item_type: str
    description: str  # "JFK → CDG (Air France)" or "Hyatt Paris (3 nights)"
    payment_type: Literal["cash", "points"]
    cash_paid: float
    points_used: Optional[int]
    program_used: Optional[str]
    
@dataclass
class TransferInstruction:
    from_program: str        # "amex"
    from_program_name: str   # "American Express Membership Rewards"
    to_program: str          # "HH"
    to_program_name: str     # "Hilton Honors"
    points_to_transfer: int
    transfer_ratio: str      # "1:1" or "1:2"
    resulting_points: int
    transfer_time: str       # "instant", "1-2 days"
    portal_url: str
    steps: List[str]
```

### 3.5 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 3.5.1 | Define `MinOOPSolution`, `PaymentInstruction`, `TransferInstruction` | `src/handlers/min_oop_optimizer.py` |
| 3.5.2 | Implement `minimize_out_of_pocket()` ILP solver | `src/handlers/min_oop_optimizer.py` |
| 3.5.3 | Add `_extract_solution()` helper | `src/handlers/min_oop_optimizer.py` |
| 3.5.4 | Add `_build_transfer_steps()` for human-readable instructions | `src/handlers/min_oop_optimizer.py` |
| 3.5.5 | Unit tests with sample scenarios | `tests/test_min_oop_optimizer.py` |

---

## Phase 4: API Endpoints

### 4.1 New Endpoint: Optimize Trip Out-of-Pocket

**File:** `src/app.py`

```python
class OptimizeTripOOPRequest(BaseModel):
    trip_id: str
    # Optional: override user points (for simulation)
    points_override: Optional[Dict[str, int]] = None
    # Optional: force minimum points usage
    min_points_usage_pct: Optional[float] = 0.0
    # Optional: max cash budget
    max_cash_budget: Optional[float] = None
    # Include hotels in optimization
    include_hotels: bool = True


@app.post("/api/trip/optimize-out-of-pocket")
async def optimize_trip_out_of_pocket(
    body: OptimizeTripOOPRequest,
    user_id: str = Depends(require_auth),
):
    """
    Optimize entire trip for minimum out-of-pocket cost.
    
    Returns transfer instructions and payment breakdown for all
    flights and hotels, prioritizing lowest total cash paid.
    """
    from src.handlers.trip_cost_optimizer import aggregate_trip_costs
    from src.handlers.min_oop_optimizer import minimize_out_of_pocket
    
    # Get user's points
    user_points = body.points_override or await points_service.get_user_points(user_id)
    
    # Aggregate all trip costs
    cost_summary = await aggregate_trip_costs(body.trip_id, user_points)
    
    # Solve optimization
    solution = minimize_out_of_pocket(
        items=cost_summary.all_items,
        available_points=user_points,
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
        min_points_usage_pct=body.min_points_usage_pct or 0.0,
        max_cash_budget=body.max_cash_budget,
    )
    
    return {
        "status": solution.status,
        "total_out_of_pocket": solution.total_out_of_pocket,
        "total_points_used": solution.total_points_used,
        "all_cash_cost": solution.all_cash_cost,
        "savings": solution.savings,
        "payment_plan": [asdict(p) for p in solution.payment_plan],
        "transfer_plan": [asdict(t) for t in solution.transfer_plan],
        "points_breakdown": solution.points_breakdown,
    }
```

### 4.2 New Endpoint: Simulate Transfer Strategy

```python
class SimulateTransferRequest(BaseModel):
    available_points: Dict[str, int]  # {"amex": 1000000}
    target_expenses: List[Dict]  # [{"type": "flight", "cash": 400, "points": 20000, ...}]


@app.post("/api/transfers/simulate")
async def simulate_transfer_strategy(body: SimulateTransferRequest):
    """
    Simulate optimal point allocation for given expenses.
    
    Useful for "what if" scenarios without a saved trip.
    """
    # Convert to TripCostItems
    items = [_dict_to_trip_cost_item(e) for e in body.target_expenses]
    
    solution = minimize_out_of_pocket(
        items=items,
        available_points=body.available_points,
        transfer_graph=EXTENDED_TRANSFER_GRAPH,
    )
    
    return {
        "optimal_out_of_pocket": solution.total_out_of_pocket,
        "recommended_transfers": solution.transfer_plan,
        "payment_breakdown": solution.payment_plan,
    }
```

### 4.3 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 4.3.1 | Add `OptimizeTripOOPRequest` Pydantic model | `src/app.py` |
| 4.3.2 | Implement `/api/trip/optimize-out-of-pocket` endpoint | `src/app.py` |
| 4.3.3 | Add `SimulateTransferRequest` model | `src/app.py` |
| 4.3.4 | Implement `/api/transfers/simulate` endpoint | `src/app.py` |
| 4.3.5 | Add response formatting helpers | `src/utils/display_formatters.py` |

---

## Phase 5: Frontend Integration

### 5.1 Transfer Strategy Display Component

**File:** `frontend/src/components/TransferStrategy.tsx` (NEW)

```tsx
interface TransferStrategyProps {
  solution: MinOOPSolution;
}

export function TransferStrategy({ solution }: TransferStrategyProps) {
  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <CardTitle>Optimized Payment Strategy</CardTitle>
          <CardDescription>
            Save ${solution.savings.toFixed(2)} by using your points strategically
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4">
            <Stat label="Out of Pocket" value={`$${solution.total_out_of_pocket}`} />
            <Stat label="Points Used" value={solution.total_points_used.toLocaleString()} />
            <Stat label="vs. All Cash" value={`$${solution.all_cash_cost}`} highlight />
          </div>
        </CardContent>
      </Card>
      
      {/* Transfer Instructions */}
      <Card>
        <CardHeader>
          <CardTitle>Step 1: Transfer Points</CardTitle>
        </CardHeader>
        <CardContent>
          {solution.transfer_plan.map((transfer, i) => (
            <TransferInstructionCard key={i} transfer={transfer} />
          ))}
        </CardContent>
      </Card>
      
      {/* Payment Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Step 2: Book Your Trip</CardTitle>
        </CardHeader>
        <CardContent>
          {solution.payment_plan.map((payment, i) => (
            <PaymentInstructionCard key={i} payment={payment} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
```

### 5.2 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 5.2.1 | Create `TransferStrategy` component | `frontend/src/components/TransferStrategy.tsx` |
| 5.2.2 | Create `TransferInstructionCard` subcomponent | `frontend/src/components/TransferInstructionCard.tsx` |
| 5.2.3 | Create `PaymentInstructionCard` subcomponent | `frontend/src/components/PaymentInstructionCard.tsx` |
| 5.2.4 | Add API hook `useOptimizeTripOOP()` | `frontend/src/hooks/useOptimizeTripOOP.ts` |
| 5.2.5 | Integrate into itinerary page | `frontend/src/pages/Itinerary.tsx` |

---

## Phase 6: Testing & Validation

### 6.1 Test Scenarios

| Scenario | Description | Expected Outcome |
|----------|-------------|------------------|
| **Basic** | 1M Amex, flight (20k pts/$400), hotel (50k pts/$200) | Use both, OOP = surcharges only |
| **Insufficient Points** | 30k Amex, flight (50k pts), hotel (80k pts) | Pay cash for one, points for other |
| **Multi-Bank** | 50k Amex + 50k Chase, need 80k airline | Transfer from both banks |
| **Hotel-Only Points** | 100k Hilton (no bank), need flight | Pay cash for flight, points for hotel |
| **Transfer Bonus** | Amex 1:2 Hilton promo active | Leverage promo for better value |
| **Budget Constraint** | Max $100 cash, 500k points | Must use points even at low CPP |

### 6.2 Validation Against Current System

```python
def test_oop_vs_cpp_comparison():
    """
    Verify new OOP optimizer produces lower out-of-pocket than CPP optimizer.
    """
    items = [
        TripCostItem(
            item_id="flight_1",
            item_type="flight",
            cash_cost=400.0,
            points_options=[
                PointsOption(program_code="UA", points_required=20000, surcharge=50.0)
            ]
        ),
        TripCostItem(
            item_id="hotel_1",
            item_type="hotel",
            cash_cost=200.0,
            points_options=[
                PointsOption(program_code="HH", points_required=50000, surcharge=20.0)
            ]
        ),
    ]
    available_points = {"amex": 1000000}
    
    # New OOP optimizer
    oop_solution = minimize_out_of_pocket(items, available_points, EXTENDED_TRANSFER_GRAPH)
    
    # Current CPP approach (simulated)
    cpp_oop = simulate_cpp_approach(items, available_points)
    
    # OOP should be ≤ CPP approach
    assert oop_solution.total_out_of_pocket <= cpp_oop
```

### 6.3 Implementation Tasks

| Task | Description | File |
|------|-------------|------|
| 6.3.1 | Create test fixtures for common scenarios | `tests/fixtures/transfer_scenarios.py` |
| 6.3.2 | Unit tests for `minimize_out_of_pocket()` | `tests/test_min_oop_optimizer.py` |
| 6.3.3 | Integration tests for `/api/trip/optimize-out-of-pocket` | `tests/test_api_optimize_oop.py` |
| 6.3.4 | Comparison tests: OOP vs CPP approaches | `tests/test_oop_vs_cpp.py` |
| 6.3.5 | Edge case tests (no points, infeasible, etc.) | `tests/test_min_oop_edge_cases.py` |

---

## Implementation Timeline

### Priority Order

1. **Phase 1** (Transfer Graph) - Foundation for everything else
2. **Phase 3** (ILP Solver) - Core optimization logic
3. **Phase 2** (Cost Aggregation) - Connect flights + hotels
4. **Phase 4** (API Endpoints) - Expose to frontend
5. **Phase 5** (Frontend) - User-facing components
6. **Phase 6** (Testing) - Throughout development

### File Summary

| New File | Purpose |
|----------|---------|
| `src/handlers/transfer_strategy.py` | Extended transfer graph, metadata, helpers |
| `src/handlers/trip_cost_optimizer.py` | Unified cost aggregation |
| `src/handlers/min_oop_optimizer.py` | Minimum OOP ILP solver |
| `frontend/src/components/TransferStrategy.tsx` | Main strategy display |
| `frontend/src/components/TransferInstructionCard.tsx` | Transfer step card |
| `frontend/src/components/PaymentInstructionCard.tsx` | Payment step card |
| `frontend/src/hooks/useOptimizeTripOOP.ts` | API hook |
| `tests/test_transfer_strategy.py` | Transfer graph tests |
| `tests/test_min_oop_optimizer.py` | Optimizer tests |

---

## Appendix A: Transfer Partner Reference

### Bank → Airline Partners

| Bank | Airlines |
|------|----------|
| **Amex MR** | Delta, JetBlue, ANA, Singapore, Cathay, British Airways, Air France, Emirates, Etihad, Virgin Atlantic, Qantas, Avianca |
| **Chase UR** | United, Southwest, British Airways, Air France, Iberia, Singapore, Virgin Atlantic, Aer Lingus |
| **Citi TY** | JetBlue, Singapore, Cathay, Qatar, Emirates, Etihad, Turkish, Avianca |
| **Capital One** | Air Canada, Air France, British Airways, Emirates, Etihad, Finnair, Singapore, Turkish, Avianca |
| **Bilt** | United, American, Air France, Turkish, Emirates, Virgin Atlantic, Aer Lingus |

### Bank → Hotel Partners

| Bank | Hotels |
|------|--------|
| **Amex MR** | Hilton (1:2), Marriott (1:1) |
| **Chase UR** | Hyatt (1:1), Marriott (1:1), IHG (1:1) |
| **Capital One** | Accor, Wyndham |
| **Bilt** | Hyatt (1:1), IHG (1:1) |

---

## Appendix B: Example Optimization Walkthrough

**Scenario:**
- User has: 200,000 Amex MR, 100,000 Chase UR
- Trip needs:
  - Flight JFK→CDG: $800 cash OR 60,000 Air France + $120 surcharge
  - Flight CDG→JFK: $750 cash OR 55,000 United + $50 surcharge
  - Hotel Paris (5 nights): $1,200 cash OR 200,000 Hilton + $40 surcharge

**CPP Analysis (Current Approach):**
- JFK→CDG: CPP = ($800-$120)/60,000 = 1.13¢ ✓ Use points
- CDG→JFK: CPP = ($750-$50)/55,000 = 1.27¢ ✓ Use points
- Hotel: CPP = ($1,200-$40)/200,000 = 0.58¢ ✗ Pay cash

**CPP Outcome:** $1,200 + $120 + $50 = **$1,370 out-of-pocket**

**OOP Analysis (New Approach):**
- Check: Can Amex transfer to Air France? Yes (1:1)
- Check: Can Chase transfer to United? Yes (1:1)
- Check: Can Amex transfer to Hilton? Yes (1:2, so 100k MR = 200k Hilton)

**OOP Outcome:**
1. Transfer 60,000 Amex → Air France
2. Transfer 55,000 Chase → United
3. Transfer 100,000 Amex → 200,000 Hilton

Total out-of-pocket: $120 + $50 + $40 = **$210**

**Savings: $1,160 (84% reduction)**

---

## Appendix C: ILP Variables Reference

```
Decision Variables:
- pay_cash[i] ∈ {0,1}        : 1 if item i paid with cash
- use_points[i,p] ∈ {0,1}    : 1 if item i paid with program p's points
- transfer[b,p] ∈ ℤ⁺         : Points transferred from bank b to program p

Parameters:
- cash_cost[i]               : Cash price for item i
- surcharge[i,p]             : Surcharge when using program p for item i
- points_req[i,p]            : Points required from program p for item i
- balance[s]                 : Available points in source s (bank or program)
- ratio[b,p]                 : Transfer ratio from bank b to program p
- allowed[b,p] ∈ {0,1}       : 1 if bank b can transfer to program p

Objective:
  Minimize Σᵢ (pay_cash[i] × cash_cost[i] + Σₚ use_points[i,p] × surcharge[i,p])

Constraints:
  ∀i: pay_cash[i] + Σₚ use_points[i,p] = 1                    (pay once)
  ∀p: Σᵢ use_points[i,p] × points_req[i,p] ≤ effective_balance[p]  (points limit)
  ∀b: Σₚ transfer[b,p] ≤ balance[b]                           (bank limit)
  ∀b,p: transfer[b,p] × ratio[b,p] ≥ points_from_transfer_used[b,p]  (transfer delivery)
```
