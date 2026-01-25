# OOP (Out Of Pocket) Prioritization Implementation Plan

## Executive Summary

This document outlines the implementation plan to prioritize **OOP (Out Of Pocket) optimization** over **CPP (Cents Per Point) optimization** throughout the Tripy application. The goal is to minimize the total cash a user pays out-of-pocket, using points more aggressively whenever they reduce cash costs.

---

## Current State Analysis

### Existing Optimization Modes

| Mode | Objective | CPP Threshold | Behavior |
|------|-----------|---------------|----------|
| **OOP** | Minimize cash paid | 0.5¢ | Uses points aggressively to reduce out-of-pocket costs |
| **CPP** | Maximize redemption value | 1.0-1.8¢ | Only uses points for high-value redemptions |

### Current Defaults

| Location | Current Setting |
|----------|-----------------|
| `points_maximizer.py:104` | `"oop"` (default parameter) |
| `ilp_adapter.py:191` | `"oop"` (default parameter) |
| `itinerary_service.py:1999` | `"oop"` (hardcoded) |
| `solo_trip/orchestrator.py:226` | `"oop"` (hardcoded) |

### Key Findings

1. OOP is already the default mode, but implementation is inconsistent
2. No UI control exists for users to see/change optimization strategy
3. Some code paths may not explicitly enforce OOP
4. Weight configurations could be tuned for more aggressive OOP behavior

---

## Implementation Phases

### Phase 1: Enforce OOP as Primary Strategy ✓ (Audit & Harden)

#### 1.1 Audit All Optimization Entry Points

**Files to verify:**

```
backend/src/handlers/points_maximizer.py
backend/src/handlers/ilp_adapter.py
backend/src/handlers/planTrip.py
backend/src/services/itinerary_service.py
backend/src/handlers/solo_trip/orchestrator.py
backend/src/handlers/solo_trip/optimizer.py
```

**Action Items:**
- [ ] Ensure all function signatures default to `optimization_mode="oop"`
- [ ] Remove any hardcoded `"cpp"` references
- [ ] Add logging to track which mode is being used

#### 1.2 Create Centralized Configuration

**New file: `backend/src/config/optimization_config.py`**

```python
"""
Centralized optimization configuration.
OOP (Out Of Pocket) is the primary strategy.
"""

from typing import Literal

# Primary optimization mode - OOP minimizes cash paid
DEFAULT_OPTIMIZATION_MODE: Literal["oop", "cpp"] = "oop"

# OOP Mode Configuration
OOP_CONFIG = {
    # Minimum CPP threshold - use points if value >= 0.5¢
    "min_cpp_threshold": 0.5,
    
    # Weight priorities (higher = more important)
    "weights": {
        "points_savings": 10**7,    # Highest priority: maximize points usage
        "cash_minimization": 10**6,  # Second: minimize cash
        "surcharge_penalty": 10**3,  # Third: avoid high surcharges
        "travel_time": 1.0,          # Lowest: optimize travel time
    },
    
    # Surcharge thresholds
    "max_surcharge_ratio": 0.50,     # Reject if surcharge > 50% of cash price
    "surcharge_penalty_start": 0.20, # Start penalizing at 20%
}

# CPP Mode Configuration (secondary, for comparison only)
CPP_CONFIG = {
    "min_cpp_threshold": 1.0,  # Default minimum
    "program_thresholds": {
        # Premium programs
        "SQ": 1.5, "NH": 1.5, "JL": 1.4, "VS": 1.3, "CX": 1.3,
        # High-surcharge programs
        "BA": 1.8, "LH": 1.6, "LX": 1.6,
        # US Domestic
        "UA": 1.0, "AA": 1.0, "DL": 1.0, "B6": 0.9,
    },
    "weights": {
        "points_value": 10**6,
        "cash_cost": 10**3,
        "travel_time": 1.0,
        "card_benefits": 10**4,
    },
}

def get_optimization_config(mode: str = None):
    """Get configuration for the specified optimization mode."""
    mode = mode or DEFAULT_OPTIMIZATION_MODE
    return OOP_CONFIG if mode == "oop" else CPP_CONFIG
```

#### 1.3 Update All Consumers

**points_maximizer.py changes:**

```python
# Before
def optimize_trip_ilp(
    ...
    optimization_mode: OptimizationMode = "oop",
    ...
):

# After
from src.config.optimization_config import DEFAULT_OPTIMIZATION_MODE, get_optimization_config

def optimize_trip_ilp(
    ...
    optimization_mode: OptimizationMode = DEFAULT_OPTIMIZATION_MODE,
    ...
):
    config = get_optimization_config(optimization_mode)
    # Use config["weights"], config["min_cpp_threshold"], etc.
```

---

### Phase 2: Enhance OOP Algorithm

#### 2.1 More Aggressive Points Usage

**Current behavior:** Uses points if CPP >= 0.5¢

**Enhanced behavior:**
- Lower threshold to 0.3¢ for users who want maximum points usage
- Add "aggressive OOP" sub-mode that uses points even at lower values
- Consider points expiration (use points that might expire soon)

**Implementation:**

```python
# In optimization_config.py
OOP_AGGRESSIVE_CONFIG = {
    "min_cpp_threshold": 0.3,  # Even lower threshold
    "prefer_points_over_cash": True,  # When equal cost, prefer points
    "expiring_points_bonus": 1.2,  # 20% bonus weight for expiring points
}
```

#### 2.2 Improved Surcharge Handling

**Current:** Rejects awards with surcharges > 50% of cash price

**Enhanced:**
- Partner program awareness (e.g., use AA miles for BA flights to avoid BA surcharges)
- Surcharge comparison across all programs for same route
- Net cost calculation: `total_cost = cash_saved - surcharge`

**Implementation in ILP:**

```python
def calculate_oop_objective(flight_option, points_used, config):
    """
    Enhanced OOP objective calculation.
    
    Objective: Minimize total out-of-pocket while maximizing points usage.
    """
    cash_price = flight_option.cash_price
    award_surcharge = flight_option.surcharge
    points_required = flight_option.points_required
    
    # Net savings from using points
    cash_saved = cash_price - award_surcharge
    
    # CPP calculation
    cpp = (cash_saved / points_required) * 100 if points_required > 0 else 0
    
    # OOP score: higher is better
    if cpp >= config["min_cpp_threshold"]:
        # Points are worth using
        oop_score = (
            config["weights"]["points_savings"] * cash_saved +
            config["weights"]["cash_minimization"] * (cash_price - award_surcharge) -
            config["weights"]["surcharge_penalty"] * award_surcharge
        )
    else:
        # Points not worth using, pay cash
        oop_score = -config["weights"]["cash_minimization"] * cash_price
    
    return oop_score
```

#### 2.3 Transfer Optimization for OOP

**Goal:** Find the cheapest transfer path that minimizes total cost

**Implementation:**

```python
def find_oop_optimal_transfer(
    user_points: dict,
    required_miles: int,
    target_program: str,
    flight_surcharge: float,
    cash_price: float,
) -> TransferRecommendation:
    """
    Find the transfer path that minimizes out-of-pocket cost.
    
    Considers:
    - Transfer ratios (some transfers lose value)
    - Available balances
    - Net cost after surcharges
    """
    candidates = []
    
    for source_program, balance in user_points.items():
        transfer_path = get_transfer_path(source_program, target_program)
        if not transfer_path:
            continue
        
        ratio = transfer_path.ratio  # e.g., 1.0 or 0.75
        points_needed_from_source = required_miles / ratio
        
        if balance >= points_needed_from_source:
            net_cash_cost = flight_surcharge
            cash_saved = cash_price - flight_surcharge
            cpp = (cash_saved / points_needed_from_source) * 100
            
            candidates.append({
                "source": source_program,
                "target": target_program,
                "points_used": points_needed_from_source,
                "net_cash_cost": net_cash_cost,
                "cash_saved": cash_saved,
                "cpp": cpp,
            })
    
    # Sort by lowest net cash cost (OOP optimization)
    candidates.sort(key=lambda x: x["net_cash_cost"])
    
    return candidates[0] if candidates else None
```

---

### Phase 3: Add OOP Visibility to UI

#### 3.1 Display OOP Metrics

**Frontend changes for results pages:**

```typescript
// frontend/src/components/ItineraryCard.tsx

interface OOPMetrics {
  totalCashPrice: number;      // What you'd pay in all cash
  totalPointsUsed: number;     // Points being redeemed
  outOfPocket: number;         // Actual cash you'll pay (surcharges + taxes)
  cashSaved: number;           // totalCashPrice - outOfPocket
  savingsPercentage: number;   // (cashSaved / totalCashPrice) * 100
}

const OOPSummary: React.FC<{ metrics: OOPMetrics }> = ({ metrics }) => (
  <div className="oop-summary bg-green-50 p-4 rounded-lg">
    <h3 className="font-bold text-lg">Out-of-Pocket Summary</h3>
    
    <div className="grid grid-cols-2 gap-4 mt-2">
      <div>
        <span className="text-gray-600">Cash Price:</span>
        <span className="line-through">${metrics.totalCashPrice}</span>
      </div>
      
      <div>
        <span className="text-gray-600">Points Used:</span>
        <span>{metrics.totalPointsUsed.toLocaleString()}</span>
      </div>
      
      <div className="col-span-2">
        <span className="text-gray-600">You Pay:</span>
        <span className="text-2xl font-bold text-green-600">
          ${metrics.outOfPocket}
        </span>
      </div>
      
      <div className="col-span-2 bg-green-100 p-2 rounded">
        <span className="text-green-800 font-semibold">
          Saving ${metrics.cashSaved} ({metrics.savingsPercentage}% off)
        </span>
      </div>
    </div>
  </div>
);
```

#### 3.2 Per-Segment OOP Breakdown

**Show users exactly where their money goes:**

```typescript
interface SegmentOOP {
  segment: string;           // "JFK → CDG"
  cashPrice: number;         // $800
  pointsUsed: number;        // 45,000
  program: string;           // "Air France Flying Blue"
  surcharge: number;         // $50
  youPay: number;            // $50 (surcharge only)
  recommendation: "points" | "cash";
}

const SegmentBreakdown: React.FC<{ segments: SegmentOOP[] }> = ({ segments }) => (
  <div className="segment-breakdown">
    {segments.map((seg, idx) => (
      <div key={idx} className="segment-row flex justify-between p-2 border-b">
        <div>
          <span className="font-medium">{seg.segment}</span>
          {seg.recommendation === "points" && (
            <span className="ml-2 text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
              {seg.pointsUsed.toLocaleString()} {seg.program}
            </span>
          )}
        </div>
        <div>
          {seg.recommendation === "points" ? (
            <>
              <span className="line-through text-gray-400">${seg.cashPrice}</span>
              <span className="ml-2 font-bold">${seg.surcharge}</span>
            </>
          ) : (
            <span className="font-bold">${seg.cashPrice}</span>
          )}
        </div>
      </div>
    ))}
  </div>
);
```

#### 3.3 Optional: Mode Toggle (Future)

If users want to compare strategies, add an advanced toggle:

```typescript
// frontend/src/components/OptimizationModeToggle.tsx

const OptimizationModeToggle: React.FC<{
  mode: "oop" | "cpp";
  onChange: (mode: "oop" | "cpp") => void;
}> = ({ mode, onChange }) => (
  <div className="flex items-center gap-4 p-4 bg-gray-50 rounded">
    <span className="text-sm text-gray-600">Optimization Strategy:</span>
    
    <label className={`cursor-pointer px-3 py-1 rounded ${
      mode === "oop" ? "bg-green-500 text-white" : "bg-gray-200"
    }`}>
      <input
        type="radio"
        name="opt-mode"
        value="oop"
        checked={mode === "oop"}
        onChange={() => onChange("oop")}
        className="hidden"
      />
      Minimize Cash (OOP)
    </label>
    
    <label className={`cursor-pointer px-3 py-1 rounded ${
      mode === "cpp" ? "bg-blue-500 text-white" : "bg-gray-200"
    }`}>
      <input
        type="radio"
        name="opt-mode"
        value="cpp"
        checked={mode === "cpp"}
        onChange={() => onChange("cpp")}
        className="hidden"
      />
      Maximize Value (CPP)
    </label>
    
    <div className="text-xs text-gray-500 ml-2">
      {mode === "oop" 
        ? "Uses points whenever they save you cash"
        : "Only uses points for high-value redemptions (≥1¢/point)"
      }
    </div>
  </div>
);
```

---

### Phase 4: API Enhancements

#### 4.1 Add OOP Metrics to Response

**Update backend response schema:**

```python
# backend/src/models/itinerary.py

class OOPMetrics(BaseModel):
    """Out-of-pocket optimization metrics."""
    total_cash_price: float          # Sum of all cash prices
    total_out_of_pocket: float       # Actual cash to pay
    total_points_used: int           # Total points redeemed
    cash_saved: float                # total_cash_price - total_out_of_pocket
    savings_percentage: float        # (cash_saved / total_cash_price) * 100
    average_cpp: float               # Weighted average CPP across segments
    points_breakdown: dict           # {program: points_used}

class ItineraryResponse(BaseModel):
    """Enhanced itinerary response with OOP metrics."""
    id: str
    segments: List[FlightSegment]
    oop_metrics: OOPMetrics          # NEW: OOP summary
    transfer_instructions: List[TransferInstruction]
    booking_links: List[BookingLink]
```

#### 4.2 OOP Comparison Endpoint

**New endpoint to compare OOP vs CPP:**

```python
# backend/src/routes/optimization.py

@router.post("/compare-strategies")
async def compare_optimization_strategies(
    request: TripRequest,
) -> dict:
    """
    Compare OOP vs CPP strategies for the same trip.
    Useful for users who want to understand the trade-offs.
    """
    oop_result = await optimize_trip(request, mode="oop")
    cpp_result = await optimize_trip(request, mode="cpp")
    
    return {
        "recommended": "oop",  # Always recommend OOP
        "comparison": {
            "oop": {
                "out_of_pocket": oop_result.oop_metrics.total_out_of_pocket,
                "points_used": oop_result.oop_metrics.total_points_used,
                "cash_saved": oop_result.oop_metrics.cash_saved,
            },
            "cpp": {
                "out_of_pocket": cpp_result.oop_metrics.total_out_of_pocket,
                "points_used": cpp_result.oop_metrics.total_points_used,
                "average_cpp": cpp_result.oop_metrics.average_cpp,
            },
        },
        "explanation": generate_comparison_explanation(oop_result, cpp_result),
    }
```

---

### Phase 5: Testing & Validation

#### 5.1 Unit Tests

```python
# backend/tests/test_oop_optimization.py

import pytest
from src.handlers.points_maximizer import optimize_trip_ilp
from src.config.optimization_config import DEFAULT_OPTIMIZATION_MODE

class TestOOPOptimization:
    """Tests to ensure OOP is prioritized correctly."""
    
    def test_default_mode_is_oop(self):
        """Verify OOP is the default optimization mode."""
        assert DEFAULT_OPTIMIZATION_MODE == "oop"
    
    def test_oop_minimizes_cash(self):
        """OOP should choose option with lowest out-of-pocket."""
        # Setup: Two options for same flight
        # Option A: $200 cash
        # Option B: 10,000 points + $50 surcharge
        # OOP should choose B (saves $150 cash)
        
        result = optimize_trip_ilp(
            flights=[...],
            user_points={"Chase": 50000},
            optimization_mode="oop",
        )
        
        assert result.segments[0].payment_method == "points"
        assert result.oop_metrics.total_out_of_pocket == 50
    
    def test_oop_uses_points_at_low_cpp(self):
        """OOP uses points even at low CPP if it saves cash."""
        # Setup: 20,000 points + $100 surcharge for $200 flight
        # CPP = ($200 - $100) / 20,000 = 0.5¢
        # CPP mode would reject, OOP should accept
        
        result = optimize_trip_ilp(
            flights=[...],
            user_points={"Chase": 50000},
            optimization_mode="oop",
        )
        
        assert result.segments[0].payment_method == "points"
    
    def test_oop_rejects_bad_surcharges(self):
        """OOP rejects awards where surcharge > 50% of cash price."""
        # Setup: 10,000 points + $150 surcharge for $200 flight
        # Surcharge is 75% of cash price - should reject
        
        result = optimize_trip_ilp(
            flights=[...],
            user_points={"Chase": 50000},
            optimization_mode="oop",
        )
        
        assert result.segments[0].payment_method == "cash"
```

#### 5.2 Integration Tests

```python
# backend/tests/integration/test_oop_e2e.py

async def test_solo_trip_uses_oop():
    """End-to-end test that solo trips use OOP optimization."""
    response = await client.post("/solo/optimize", json={
        "origin": "JFK",
        "destination": "CDG",
        "departure_date": "2024-06-01",
        "return_date": "2024-06-08",
        "points": {"Chase UR": 100000},
    })
    
    data = response.json()
    
    # Verify OOP metrics are present
    assert "oop_metrics" in data
    assert data["oop_metrics"]["total_out_of_pocket"] <= data["oop_metrics"]["total_cash_price"]

async def test_group_trip_uses_oop():
    """End-to-end test that group trips use OOP optimization."""
    # Similar test for group trips
    ...
```

#### 5.3 Regression Tests

```python
# backend/tests/regression/test_oop_consistency.py

KNOWN_GOOD_RESULTS = [
    {
        "trip": {"origin": "JFK", "dest": "CDG", "points": 60000},
        "expected_oop": 89.0,  # Known good out-of-pocket
        "expected_points_used": 45000,
    },
    # More test cases...
]

@pytest.mark.parametrize("case", KNOWN_GOOD_RESULTS)
def test_oop_produces_consistent_results(case):
    """Ensure OOP optimization produces consistent results."""
    result = optimize_trip(case["trip"])
    
    assert abs(result.oop_metrics.total_out_of_pocket - case["expected_oop"]) < 10
    assert result.oop_metrics.total_points_used == case["expected_points_used"]
```

---

## Implementation Checklist

### Phase 1: Audit & Harden (Priority: High)
- [ ] Create `optimization_config.py` with centralized settings
- [ ] Update `points_maximizer.py` to use centralized config
- [ ] Update `ilp_adapter.py` to use centralized config
- [ ] Update `itinerary_service.py` to use centralized config
- [ ] Update `solo_trip/orchestrator.py` to use centralized config
- [ ] Add logging for optimization mode tracking
- [ ] Write unit tests for default mode verification

### Phase 2: Algorithm Enhancement (Priority: High)
- [ ] Implement enhanced surcharge handling
- [ ] Add partner program awareness for surcharge avoidance
- [ ] Implement transfer path optimization for OOP
- [ ] Tune weight configurations based on real-world testing
- [ ] Add "aggressive OOP" sub-mode option

### Phase 3: UI Updates (Priority: Medium)
- [ ] Add OOP metrics display to results pages
- [ ] Implement per-segment cost breakdown
- [ ] Add savings visualization
- [ ] (Optional) Add mode comparison toggle

### Phase 4: API Updates (Priority: Medium)
- [ ] Add `OOPMetrics` to response schema
- [ ] Update all endpoints to return OOP metrics
- [ ] (Optional) Add strategy comparison endpoint

### Phase 5: Testing (Priority: High)
- [ ] Write unit tests for OOP behavior
- [ ] Write integration tests for end-to-end flows
- [ ] Create regression test suite
- [ ] Performance testing for optimization speed

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Default mode | OOP in 100% of code paths |
| Cash savings | ≥70% average savings vs all-cash booking |
| Points utilization | ≥80% of available points used when beneficial |
| User satisfaction | Clear understanding of where money goes |
| Test coverage | ≥90% for optimization logic |

---

## Appendix: OOP vs CPP Decision Tree

```
Is CPP >= 0.5¢?
├── NO → Pay cash (points not worth using)
└── YES → Is surcharge > 50% of cash price?
    ├── YES → Pay cash (surcharge too high)
    └── NO → Use points (minimizes out-of-pocket)
        └── Find best transfer path
            └── Calculate net savings
                └── Display to user
```

---

## Appendix: File Reference

| File | Purpose |
|------|---------|
| `backend/src/config/optimization_config.py` | Centralized OOP/CPP configuration (NEW) |
| `backend/src/handlers/points_maximizer.py` | Main ILP optimization logic |
| `backend/src/handlers/ilp_adapter.py` | ILP solver adapter |
| `backend/src/handlers/planTrip.py` | Alternative optimization handler |
| `backend/src/services/itinerary_service.py` | Group trip itinerary service |
| `backend/src/handlers/solo_trip/orchestrator.py` | Solo trip orchestration |
| `backend/src/handlers/transfer_strategy.py` | Transfer path optimization |
| `frontend/src/app/(app)/group/results/page.tsx` | Group results display |
| `frontend/src/app/(app)/solo/results/page.tsx` | Solo results display |
