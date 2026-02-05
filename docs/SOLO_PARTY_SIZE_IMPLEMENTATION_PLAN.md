# Solo Trip Party Size Implementation Plan

**Created:** February 4, 2026  
**Last Updated:** February 4, 2026  
**Status:** Planning  
**Priority:** High  
**Scope:** Solo trips - flights only (aligns with group optimizer scope)

---

## Executive Summary

The solo trip party size feature (Adults/Children/Bags selector in the UI) is **captured and stored** but **never used** in the optimization or flight search. When a user selects 2 Adults + 1 Child, the system:

1. ❌ Searches for flights with `pax=1` (default)
2. ❌ Shows per-person prices instead of total party cost
3. ❌ Compares per-person cost against total budget
4. ❌ Calculates points required for 1 person, not the party

This document provides a detailed implementation plan to fix these issues.

---

## Table of Contents

1. [Current Data Flow Analysis](#1-current-data-flow-analysis)
2. [Root Cause Summary](#2-root-cause-summary)
3. [Implementation Phases](#3-implementation-phases)
4. [Phase 1: Data Model Updates](#phase-1-data-model-updates)
5. [Phase 2: Flight Search Updates](#phase-2-flight-search-updates)
6. [Phase 3: Optimization Updates](#phase-3-optimization-updates)
7. [Phase 4: Results Display Updates](#phase-4-results-display-updates)
8. [Testing Plan](#testing-plan)
9. [Files Changed Summary](#files-changed-summary)

---

## 1. Current Data Flow Analysis

### Frontend Capture (✅ Working)

```
frontend/src/app/(app)/solo/setup/page.tsx
├── State: adults (default 1), children (default 0), bags (default 1)
├── UI: Adults/Children/Bags selector component
└── API Call: solo.createTrip({ adults, children, bags, ... })
```

### API Request (✅ Working)

```
frontend/src/lib/api.ts -> solo.createTrip()
├── Sends: adults, children, bags in request body
└── Endpoint: POST /solo/trips
```

### Backend Storage (✅ Working)

```
backend/src/services/solo_trip_service.py -> create_trip()
├── Stores: adults, children, bags in DynamoDB trip record
└── Fields saved as-is
```

### Optimization Retrieval (❌ BROKEN)

```
backend/src/handlers/solo_trip/validator.py -> build_trip_input()
├── Retrieves: num_bags ✅
├── MISSING: adults ❌
└── MISSING: children ❌
```

### TripInput Model (❌ MISSING FIELDS)

```
backend/src/handlers/solo_trip/models.py -> TripInput
├── Has: num_bags
├── MISSING: num_adults ❌
└── MISSING: num_children ❌
```

### Flight Search (❌ NOT USING PARTY SIZE)

```
backend/src/handlers/solo_trip/flight_searcher.py -> search_all_options()
├── Does NOT pass pax/adults/children to APIs
└── All searches default to 1 passenger
```

### Optimization (❌ TREATING AS SINGLE TRAVELER)

```
backend/src/handlers/solo_trip/orchestrator.py -> _run_optimization()
├── Line 190-192: "Build traveler data (solo trip = single traveler)"
├── Creates 1 traveler regardless of party size
├── Budget not multiplied by party_size
└── Costs not scaled by party_size
```

---

## 2. Root Cause Summary

| Issue | Location | Impact |
|-------|----------|--------|
| `TripInput` missing `num_adults`, `num_children` | `models.py` | Party size lost before optimization |
| Validator doesn't extract adults/children | `validator.py` | Even if model had fields, they wouldn't be populated |
| Flight search doesn't use party size | `flight_searcher.py` | APIs return prices for 1 passenger |
| Orchestrator treats as single traveler | `orchestrator.py` | ILP builds for 1 person |
| Results not scaled by party size | `orchestrator.py` | UI shows per-person prices |

---

## 3. Implementation Phases

| Phase | Description | Risk | Dependencies |
|-------|-------------|------|--------------|
| 1 | Data Model Updates | Low | None |
| 2 | Flight Search Updates | Medium | Phase 1 |
| 3 | Optimization Updates | High | Phase 1, 2 |
| 4 | Results Display Updates | Low | Phase 3 |

---

## Phase 1: Data Model Updates

### 1.1 Update `TripInput` Model

**File:** `backend/src/handlers/solo_trip/models.py`

**Current:**
```python
@dataclass
class TripInput:
    """User input for trip generation - all validated fields."""
    trip_id: str
    start_destination: str
    end_destination: str
    destinations: List[Destination]
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    flexible_dates: bool = False
    duration_days: Optional[int] = None
    max_budget: Optional[float] = None
    points_balances: Dict[str, int] = field(default_factory=dict)
    cabin_class: CabinClass = CabinClass.ECONOMY
    include_hotels: bool = False
    hotel_class: Optional[str] = None
    num_bags: int = 0
    one_way: bool = False
```

**Updated:**
```python
@dataclass
class TripInput:
    """User input for trip generation - all validated fields."""
    trip_id: str
    start_destination: str
    end_destination: str
    destinations: List[Destination]
    start_date: Optional[date] = None
    end_date: Optional[date] = None
    flexible_dates: bool = False
    duration_days: Optional[int] = None
    max_budget: Optional[float] = None  # Total budget for entire party
    points_balances: Dict[str, int] = field(default_factory=dict)
    cabin_class: CabinClass = CabinClass.ECONOMY
    include_hotels: bool = False
    hotel_class: Optional[str] = None
    num_bags: int = 0
    one_way: bool = False
    
    # Party size fields (NEW)
    num_adults: int = 1
    num_children: int = 0
    
    @property
    def party_size(self) -> int:
        """Total number of travelers in the party."""
        return self.num_adults + self.num_children
    
    @property
    def pax(self) -> int:
        """Alias for party_size, used in flight API calls."""
        return self.party_size
```

### 1.2 Update Validator to Extract Party Size

**File:** `backend/src/handlers/solo_trip/validator.py`

**Current `build_trip_input()` (around line 458-480):**
```python
return TripInput(
    trip_id=trip_data.get("trip_id") or trip_data.get("tripId", ""),
    # ... other fields ...
    num_bags=trip_data.get("num_bags") or trip_data.get("numBags", 0),
    one_way=trip_data.get("one_way") or trip_data.get("oneWay", False),
)
```

**Updated:**
```python
return TripInput(
    trip_id=trip_data.get("trip_id") or trip_data.get("tripId", ""),
    # ... other fields ...
    num_bags=trip_data.get("num_bags") or trip_data.get("numBags") or trip_data.get("bags", 0),
    one_way=trip_data.get("one_way") or trip_data.get("oneWay", False),
    # Party size (NEW)
    num_adults=max(1, trip_data.get("num_adults") or trip_data.get("adults", 1)),
    num_children=max(0, trip_data.get("num_children") or trip_data.get("children", 0)),
)
```

### 1.3 Update Solo Trip Service to Pass Party Size to Orchestrator

**File:** `backend/src/services/solo_trip_service.py`

The trip data retrieved from DynamoDB already has `adults`, `children`, `bags`. Verify these are passed to the orchestrator in the correct format:

**Check `get_trip_for_optimization()` (around line 330):**
```python
return {
    # ... existing fields ...
    "adults": trip_prefs.get("adults"),
    "children": trip_prefs.get("children"),
    "bags": trip_prefs.get("bags"),  # Already present
}
```

---

## Phase 2: Flight Search Updates

### 2.1 Update Flight Searcher to Accept Party Size

**File:** `backend/src/handlers/solo_trip/flight_searcher.py`

**Current `search_all_options()` signature:**
```python
async def search_all_options(
    self,
    origin: str,
    destination: str,
    search_date: date,
    cabin_class: CabinClass = CabinClass.ECONOMY,
    include_connections: bool = True,
    user_points: Optional[Dict[str, int]] = None,
    filters: Optional[Dict[str, Any]] = None
) -> FlightSearchResult:
```

**Updated signature:**
```python
async def search_all_options(
    self,
    origin: str,
    destination: str,
    search_date: date,
    cabin_class: CabinClass = CabinClass.ECONOMY,
    include_connections: bool = True,
    user_points: Optional[Dict[str, int]] = None,
    filters: Optional[Dict[str, Any]] = None,
    # Party size (NEW)
    num_adults: int = 1,
    num_children: int = 0,
) -> FlightSearchResult:
```

**Updated implementation:**
```python
async def search_all_options(
    self,
    origin: str,
    destination: str,
    search_date: date,
    cabin_class: CabinClass = CabinClass.ECONOMY,
    include_connections: bool = True,
    user_points: Optional[Dict[str, int]] = None,
    filters: Optional[Dict[str, Any]] = None,
    num_adults: int = 1,
    num_children: int = 0,
) -> FlightSearchResult:
    """
    Searches for ALL flight options between origin and destination.
    
    Args:
        origin: Origin airport code
        destination: Destination airport code
        search_date: Date to search
        cabin_class: Cabin class to search
        include_connections: Whether to include connecting flights
        user_points: User's points balances
        filters: Additional filters
        num_adults: Number of adult passengers (NEW)
        num_children: Number of child passengers (NEW)
    
    Returns:
        FlightSearchResult with all options (prices are PER PERSON)
    """
    from src.handlers.flights import (
        get_flights_award_first_with_points_async,
        get_flights_serp_first_with_points_async,
        get_flights_serp_only,
    )
    
    date_str = search_date.isoformat()
    filt = filters or {}
    filt["outbound_date"] = date_str
    filt["travel_class"] = self._cabin_to_filter(cabin_class)
    
    # Add party size to filters (NEW)
    party_size = num_adults + num_children
    filt["pax"] = party_size
    filt["adults"] = num_adults
    filt["children"] = num_children
    
    # ... rest of implementation ...
```

### 2.2 Update Flight Handler Functions to Use Party Size

**File:** `backend/src/handlers/flights.py`

The `get_flights_award_first_with_points_async()` and other functions need to pass `pax` to the underlying APIs.

**Current:**
```python
async def get_flights_award_first_with_points_async(
    origin: str,
    destination: str,
    user_points: Dict[str, int],
    filters: Optional[Dict] = None,
) -> List[Dict]:
    # ... 
    pax = (filters or {}).get("pax", 1)  # May already exist
```

**Verify this pattern is used consistently and pax is passed to:**
- `fetch_award_options()` - ✅ Already accepts pax
- `serp_route()` - Needs verification
- `get_google_flights()` - Needs updating

### 2.3 Update SerpAPI Function to Accept Passengers

**File:** `backend/src/services/serp_api_functions.py`

The Google Flights SerpAPI **does support** passenger count via the `adults` and `children` parameters.

**Current `get_google_flights()` signature:**
```python
def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str = None,
    travel_class: str = None,
    commercial_only: bool = False,
) -> List[Dict]:
```

**Updated:**
```python
def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str = None,
    travel_class: str = None,
    commercial_only: bool = False,
    # Party size (NEW)
    adults: int = 1,
    children: int = 0,
) -> List[Dict]:
    """
    Search Google Flights via SerpAPI.
    
    Note: Prices returned are TOTAL for the party, not per-person.
    Caller must divide by party_size if per-person prices are needed.
    """
    params = {
        "engine": "google_flights",
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": outbound_date,
        "type": 2 if return_date else 1,  # 1=one-way, 2=round-trip
        "adults": adults,  # NEW
        "children": children,  # NEW
        # ... other params ...
    }
```

### 2.4 Important: Price Normalization Decision

**Critical Decision Point:**

SerpAPI Google Flights returns **total price for all passengers**, while AwardTool returns **per-person prices**.

**Option A: Normalize to per-person everywhere** (RECOMMENDED)
- Divide SerpAPI prices by party_size
- Keep all internal calculations per-person
- Multiply by party_size only for final display/budget comparison
- Aligns with group optimizer semantics

**Option B: Use total prices everywhere**
- Multiply AwardTool prices by party_size
- Change all internal calculations to use totals
- More complex refactor

**Recommendation:** Option A - matches group optimizer and is less invasive.

**Implementation:**
```python
# In serp_route_to_leg_map() or wherever SERP results are processed:
def normalize_serp_price(total_price: float, party_size: int) -> float:
    """Convert SERP total price to per-person price."""
    if party_size <= 0:
        return total_price
    return total_price / party_size
```

---

## Phase 3: Optimization Updates

### 3.1 Update Route Graph Builder to Accept Party Size

**File:** `backend/src/handlers/solo_trip/route_graph_builder.py`

**Pass party size when calling flight searcher:**
```python
async def build_graph(
    self,
    trip_input: TripInput,
    user_points: Optional[Dict[str, int]] = None,
) -> RouteGraph:
    # ... 
    
    # Search for flights
    result = await self.flight_searcher.search_all_options(
        origin=origin,
        destination=destination,
        search_date=search_date,
        cabin_class=trip_input.cabin_class,
        user_points=user_points,
        filters=filters,
        # Party size (NEW)
        num_adults=trip_input.num_adults,
        num_children=trip_input.num_children,
    )
```

### 3.2 Update Orchestrator for Party Size Handling

**File:** `backend/src/handlers/solo_trip/orchestrator.py`

This is the most critical change. The orchestrator needs to:

1. Pass party size to graph builder
2. Scale budget appropriately (budget is for entire party, not per-person)
3. Scale final costs for display

**Current `_run_optimization()` (around line 190):**
```python
# Build traveler data (solo trip = single traveler)
traveler_id = trip_input.trip_id or "traveler_1"
travelers = [traveler_id]

start_city_by_trav = {traveler_id: trip_input.start_destination}
end_city_by_trav = {traveler_id: trip_input.end_destination}
user_points_by_trav = {traveler_id: user_points}

# Calculate budget per traveler
budget_per_trav = trip_input.max_budget if trip_input.max_budget else 1e9
```

**Updated:**
```python
# Build traveler data (solo trip = single traveler, but may have party_size > 1)
traveler_id = trip_input.trip_id or "traveler_1"
travelers = [traveler_id]
party_size = trip_input.party_size  # NEW

start_city_by_trav = {traveler_id: trip_input.start_destination}
end_city_by_trav = {traveler_id: trip_input.end_destination}
user_points_by_trav = {traveler_id: user_points}

# Budget is for the entire party
# Since flight prices in edges_dict are per-person, we divide budget by party_size
# so the ILP comparison is apples-to-apples
budget_for_ilp = trip_input.max_budget / party_size if trip_input.max_budget else 1e9

logger.info(f"Party size: {party_size} (adults={trip_input.num_adults}, children={trip_input.num_children})")
logger.info(f"Total budget: ${trip_input.max_budget}, Per-person budget for ILP: ${budget_for_ilp:.2f}")
```

**And update result extraction (around line 280):**
```python
# Extract solution data
totals = solution.get("totals", {})
per_person_oop = totals.get("cash", 0)

# Scale to total party cost (NEW)
total_oop = per_person_oop * party_size
logger.info(f"Per-person OOP: ${per_person_oop:.2f}, Total party OOP: ${total_oop:.2f}")

# Build itinerary from solution
itinerary = self._build_itinerary_from_solution(
    solution=solution,
    graph=graph,
    trip_input=trip_input,
    party_size=party_size,  # NEW: pass party size for cost scaling
)

# Check budget (compare total party cost against total budget)
within_budget = True
exceeded_by = None
suggested_budget = None
if trip_input.max_budget and total_oop > trip_input.max_budget:
    within_budget = False
    exceeded_by = total_oop - trip_input.max_budget
    suggested_budget = int(total_oop * 1.1)  # 10% buffer
```

### 3.3 Update Itinerary Building to Include Party Size

**File:** `backend/src/handlers/solo_trip/orchestrator.py`

**Update `_build_itinerary_from_solution()`:**
```python
def _build_itinerary_from_solution(
    self,
    solution: Dict[str, Any],
    graph: RouteGraph,
    trip_input: TripInput,
    party_size: int = 1,  # NEW
) -> Itinerary:
    """Build Itinerary object from ILP solution."""
    
    totals = solution.get("totals", {})
    paths = solution.get("path", {})
    pay_modes = solution.get("pay_mode", {})
    
    # Per-person totals from ILP
    per_person_cash = totals.get("cash", 0)
    per_person_surcharges = totals.get("surcharges", 0)
    
    # Scale to party totals (NEW)
    total_cash = per_person_cash * party_size
    total_surcharges = per_person_surcharges * party_size
    
    # ... build segments ...
    
    # Scale segment costs (NEW)
    for segment in flight_segments:
        if segment.cash_cost:
            segment.cash_cost = segment.cash_cost * party_size
        if segment.surcharge:
            segment.surcharge = segment.surcharge * party_size
        if segment.points_cost:
            segment.points_cost = segment.points_cost * party_size
    
    return Itinerary(
        itinerary_id=f"itinerary_{trip_input.trip_id}",
        flight_segments=flight_segments,
        transfer_plan=transfer_plan,
        total_oop=total_cash + total_surcharges,  # Scaled
        total_cash=total_cash,  # Scaled
        total_surcharges=total_surcharges,  # Scaled
        points_used=scaled_points_used,  # Scaled
        # ... other fields ...
    )
```

### 3.4 Add Party Size to Itinerary Model

**File:** `backend/src/handlers/solo_trip/models.py`

**Update `Itinerary` dataclass:**
```python
@dataclass
class Itinerary:
    """Complete optimized itinerary."""
    itinerary_id: str
    
    # Segments
    flight_segments: List[FlightSegment] = field(default_factory=list)
    transfer_plan: Optional[TransferPlan] = None
    
    # Totals (ALL REAL) - These are TOTAL for the party
    total_oop: float = 0.0
    total_cash: float = 0.0
    total_surcharges: float = 0.0
    points_used: Dict[str, int] = field(default_factory=dict)
    
    # Party size (NEW)
    party_size: int = 1
    num_adults: int = 1
    num_children: int = 0
    
    # ... rest of fields ...
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary."""
        return {
            # ... existing fields ...
            "party_size": self.party_size,
            "num_adults": self.num_adults,
            "num_children": self.num_children,
        }
```

---

## Phase 4: Results Display Updates

### 4.1 Update Results API Response

**File:** `backend/src/routes/solo_routes.py` (or wherever results are returned)

Ensure the API response includes party size information:
```python
{
    "itinerary": {
        "party_size": 3,
        "num_adults": 2,
        "num_children": 1,
        "total_oop": 1500.00,  # Total for party
        "total_cash": 1200.00,  # Total for party
        "per_person_oop": 500.00,  # Optional: for display
        "flight_segments": [
            {
                "cash_cost": 900.00,  # Total for party
                "per_person_cost": 300.00,  # Optional: for display
                # ...
            }
        ]
    }
}
```

### 4.2 Frontend Results Page Update

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

Update the results display to show:
1. Party size context (e.g., "for 2 adults, 1 child")
2. Total costs for the party
3. Optionally, per-person breakdown

```tsx
// Example display
<div>
  <h2>Total Trip Cost: ${itinerary.total_oop.toLocaleString()}</h2>
  <p className="text-gray-500">
    For {itinerary.num_adults} adult{itinerary.num_adults !== 1 ? 's' : ''}
    {itinerary.num_children > 0 && `, ${itinerary.num_children} child${itinerary.num_children !== 1 ? 'ren' : ''}`}
    {itinerary.party_size > 1 && ` (${(itinerary.total_oop / itinerary.party_size).toLocaleString()} per person)`}
  </p>
</div>
```

---

## Testing Plan

### Unit Tests

**File:** `backend/tests/test_solo_party_size.py` (NEW)

```python
import pytest
from backend.src.handlers.solo_trip.models import TripInput
from backend.src.handlers.solo_trip.validator import StrictTripInputValidator

class TestTripInputPartySize:
    """Test TripInput party size handling."""
    
    def test_party_size_property(self):
        """party_size should be adults + children."""
        trip = TripInput(
            trip_id="test",
            start_destination="JFK",
            end_destination="LAX",
            destinations=[],
            num_adults=2,
            num_children=1,
        )
        assert trip.party_size == 3
        assert trip.pax == 3
    
    def test_default_party_size(self):
        """Default should be 1 adult, 0 children."""
        trip = TripInput(
            trip_id="test",
            start_destination="JFK",
            end_destination="LAX",
            destinations=[],
        )
        assert trip.party_size == 1
        assert trip.num_adults == 1
        assert trip.num_children == 0


class TestValidatorPartySize:
    """Test validator extracts party size."""
    
    def test_build_trip_input_extracts_party_size(self):
        """Validator should extract adults and children."""
        validator = StrictTripInputValidator()
        
        trip_data = {
            "trip_id": "test",
            "start_destination": "JFK",
            "end_destination": "LAX",
            "adults": 2,
            "children": 1,
            "bags": 2,
        }
        
        # Assume validate() passes
        trip_input = validator.build_trip_input(trip_data)
        
        assert trip_input.num_adults == 2
        assert trip_input.num_children == 1
        assert trip_input.party_size == 3
        assert trip_input.num_bags == 2
    
    def test_min_adults_is_one(self):
        """num_adults should be at least 1."""
        validator = StrictTripInputValidator()
        
        trip_data = {
            "trip_id": "test",
            "start_destination": "JFK",
            "end_destination": "LAX",
            "adults": 0,  # Invalid, should become 1
            "children": 0,
        }
        
        trip_input = validator.build_trip_input(trip_data)
        assert trip_input.num_adults == 1


class TestCostScaling:
    """Test that costs are properly scaled by party size."""
    
    def test_budget_divided_by_party_size_for_ilp(self):
        """ILP should use per-person budget."""
        # Budget $1500 for party of 3 = $500 per person for ILP
        total_budget = 1500
        party_size = 3
        per_person_budget = total_budget / party_size
        assert per_person_budget == 500
    
    def test_result_costs_multiplied_by_party_size(self):
        """Final costs should be scaled to party total."""
        per_person_oop = 450.00
        party_size = 3
        total_oop = per_person_oop * party_size
        assert total_oop == 1350.00
```

### Integration Tests

**File:** `backend/tests/test_solo_party_size_integration.py` (NEW)

```python
import pytest
from backend.src.handlers.solo_trip.orchestrator import SoloTripOrchestrator

class TestSoloTripPartySizeIntegration:
    """Integration tests for party size handling."""
    
    @pytest.mark.asyncio
    async def test_full_flow_with_party_size(self):
        """Test complete flow with party_size > 1."""
        orchestrator = SoloTripOrchestrator()
        
        trip_data = {
            "trip_id": "test_party",
            "start_destination": "JFK",
            "end_destination": "LAX",
            "start_date": "2026-03-01",
            "end_date": "2026-03-07",
            "adults": 2,
            "children": 1,
            "bags": 2,
            "max_budget": 1500,
        }
        
        # This should search with pax=3 and return total party costs
        result = await orchestrator.generate_itinerary(
            trip_data=trip_data,
            user_points={"chase": 100000},
        )
        
        assert result["itinerary"]["party_size"] == 3
        # Total OOP should be 3x per-person cost
```

### Manual Testing Checklist

- [ ] Create solo trip with 2 Adults, 1 Child, 2 Bags
- [ ] Verify flight search logs show `pax=3`
- [ ] Verify optimization logs show correct budget calculation
- [ ] Verify results page shows total cost for party
- [ ] Verify results page shows party size context
- [ ] Verify budget exceeded message uses party total, not per-person
- [ ] Test edge cases: 1 adult, 0 children (default)
- [ ] Test edge cases: 4 adults, 2 children (larger party)

---

## Files Changed Summary

### Backend Files

| File | Change Type | Description |
|------|-------------|-------------|
| `backend/src/handlers/solo_trip/models.py` | MODIFY | Add `num_adults`, `num_children`, `party_size` to `TripInput` and `Itinerary` |
| `backend/src/handlers/solo_trip/validator.py` | MODIFY | Extract `adults` and `children` in `build_trip_input()` |
| `backend/src/handlers/solo_trip/flight_searcher.py` | MODIFY | Accept and pass `num_adults`, `num_children` to APIs |
| `backend/src/handlers/solo_trip/route_graph_builder.py` | MODIFY | Pass party size to flight searcher |
| `backend/src/handlers/solo_trip/orchestrator.py` | MODIFY | Scale budget/costs by party size |
| `backend/src/services/serp_api_functions.py` | MODIFY | Add `adults`, `children` params to `get_google_flights()` |
| `backend/src/handlers/flights.py` | VERIFY | Ensure `pax` is passed to all search functions |
| `backend/tests/test_solo_party_size.py` | NEW | Unit tests |
| `backend/tests/test_solo_party_size_integration.py` | NEW | Integration tests |

### Frontend Files

| File | Change Type | Description |
|------|-------------|-------------|
| `frontend/src/app/(app)/solo/results/page.tsx` | MODIFY | Display party size context and total costs |
| `frontend/src/types.ts` | MODIFY | Add `party_size`, `num_adults`, `num_children` to itinerary types |

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| SerpAPI price format mismatch | High | Verify SerpAPI returns total vs per-person, add normalization |
| ILP solver behavior change | Medium | Test with existing solo trips to ensure no regression |
| Budget comparison logic | Medium | Clear documentation, comprehensive tests |
| Frontend type changes | Low | TypeScript will catch missing fields |

---

## Implementation Order

1. **Day 1:** Phase 1 (Data Model Updates) - Low risk, foundation
2. **Day 2:** Phase 2 (Flight Search Updates) - Verify API behavior
3. **Day 3:** Phase 3 (Optimization Updates) - Core logic changes
4. **Day 4:** Phase 4 (Results Display) + Testing
5. **Day 5:** Integration testing, bug fixes, documentation

---

## Open Questions

1. **SerpAPI Price Format:** Confirm whether Google Flights SerpAPI returns total or per-person prices when `adults > 1`
2. **Points Availability:** Should we verify points availability for the full party? (Award APIs may have seat limits)
3. **Child Pricing:** Some airlines have different child fares - do we need to handle this?
4. **Infant Handling:** Should we add an `infants` field? (Infants typically don't require seats)

---

## Appendix: Current vs Expected Behavior

### Current Behavior (BROKEN)

```
User Input:
- Adults: 2
- Children: 1
- Budget: $1500

What Happens:
- Flight search: pax=1 (WRONG)
- Prices shown: $400 per person (for 1 pax)
- Budget check: $400 < $1500 ✓ (WRONG - should be $1200)
- User books, realizes they need 3x the price
```

### Expected Behavior (FIXED)

```
User Input:
- Adults: 2
- Children: 1
- Budget: $1500

What Should Happen:
- Flight search: pax=3 (adults=2, children=1)
- Prices shown: $1200 total ($400 × 3)
- Budget check: $1200 < $1500 ✓ (CORRECT)
- Per-person breakdown available: $400/person
```
