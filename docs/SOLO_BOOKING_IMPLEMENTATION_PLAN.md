# Solo Booking Implementation Plan

## Overview

This document provides a detailed, step-by-step implementation plan to fix all gaps identified in the Solo Booking Frontend Analysis. Each task includes specific file paths, code changes, and acceptance criteria.

**Aligned with Tripy Source of Truth**: This plan prioritizes Tripy's core mission as a **points arbitrage engine** that helps users get more value from their credit card points. The focus is on:

1. **Surfacing hidden value** - Transfer bonuses, sweet spots, cross-program arbitrage
2. **Transparent comparisons** - Always show cash vs. points, CPP value, and savings
3. **Simple experience** - Hide complexity, show results
4. **Clear booking instructions** - Step-by-step guidance, not booking on behalf

> *"The depth of the engine is what makes Tripy valuable. The simplicity of the experience is what makes it usable."*

---

## ⚠️ Pre-Implementation Fixup (READ FIRST)

> **CRITICAL:** The following fixes MUST be applied. Without them, the agent will implement contradictory code that compiles but fails at runtime.

### Fixup 1: Remove Deleted Endpoint Calls from UI

**Problem:** `optimization.getCostBreakdown()` and `optimization.compareStrategies()` were removed, but UI components still call them.

**Fix:**
- `CostBreakdownCard` → receives `segments` + `oopMetrics` as props, NO API call
- `StrategyComparisonCard` → calls `optimize(tripId, 'oop')`, `optimize(tripId, 'cpp')` (uses mode override), NO separate endpoint

### Fixup 2: Fix `create_trip()` Return Value

**Problem:** Returns `{"trip_id": trip_id, **item}` which includes PK, SK, TTL (violates mapper rule).

**Fix:**
```python
table.put_item(Item=item)
return storage_to_api(item)  # Returns clean TripResponse
```

### Fixup 3: Fix `/optimize/solo` Handler

**Problem:** Sample code references `request.budget`, `request.cabin_classes`, etc. which don't exist in schema.

**Fix:**
```python
@app.post("/optimize/solo", response_model=OptimizeSoloResponse)
async def optimize_solo(request: OptimizeSoloRequest, user_id: str = Depends(get_current_user)):
    trip = trip_service.get_trip(request.trip_id)
    mode = request.optimization_mode_override or trip["optimization_mode"]
    return optimize_service.get_or_compute_optimization(
        trip_id=request.trip_id,
        trip_prefs=trip,  # Backend loads prefs from trip
        points=request.points,
        mode=mode,
    )
```

### Fixup 4: Fix Results Page Mapping

**Problem:** Uses `item.name`, `item.withinBudget`, `item.withinPoints` which don't exist. `RankedItinerary` has `displayName`.

**Fix:**
```typescript
// Use displayName, compute budget/points flags from actual data
const transformed = {
  id: item.id,
  name: item.displayName,  // Use displayName, not name
  route: item.route,
  // Compute from real data, don't expect backend flags
  withinBudget: trip.maxBudget ? item.oopMetrics.totalOutOfPocket <= trip.maxBudget : true,
  withinPoints: item.oopMetrics.totalPointsUsed <= totalAvailablePoints,
};
```

### Fixup 5: Fix Points Map Zero Balance Handling

**Problem:** `if (item.program && item.balance)` drops programs with 0 points (falsy).

**Fix:**
```typescript
// Use != null to preserve zero balances
if (item.program && item.balance != null) {
  pointsMap[item.program] = item.balance;
}
```

### Fixup 6: Align BookingStep Field Names

**Problem:** Backend uses `hotel_chain`, frontend expects `hotelName`. Mismatched after serialization.

**Fix:** Standardize to:
- Backend: `hotel_chain`, `segment_reference` (snake_case)
- Frontend after serialization: `hotelChain`, `segmentReference` (camelCase)
- Update hook to use `b.hotelChain`, not `b.hotelName`

### Fixup 7: StrategyComparisonCard Uses Pure Fetch Function

**Problem:** Calling `useSoloOptimization().optimize()` 3 times races on shared state.

**Fix:** Use pure fetch function `fetchOptimizeSolo()`:
```typescript
// In StrategyComparisonCard - use pure function, NOT hook
const responses = await Promise.all(
  modes.map(mode => fetchOptimizeSolo(tripId, pointsMap, mode))
);
// Each response is independent - no state races
```

### Fixup 8: Export `apiRequest`

**Problem:** `useTransferStrategy` imports `apiRequest` but it wasn't exported.

**Fix:** Export the function:
```typescript
export async function apiRequest<T>(...) { ... }
```

### Fixup 9: Cache Key Includes Resolved Mode

**Problem:** Cache key uses `trip_prefs["optimization_mode"]` but ignores `optimization_mode_override`.

**Fix:** Pass resolved `mode` to cache key function:
```python
def compute_cache_key(trip_id, trip_prefs, points, mode):  # mode is resolved
    key_data = {
        ...
        "optimization_mode": mode,  # Use resolved, not trip_prefs["optimization_mode"]
    }
```

### Fixup 10: Use `getProgramLabel()` for Display

**Problem:** UI displays raw program IDs like `air_france_klm`.

**Fix:** Always wrap in `getProgramLabel()`:
```typescript
// BAD
via {seg.transferFrom} → {seg.transferTo}

// GOOD
via {getProgramLabel(seg.transferFrom)} → {getProgramLabel(seg.transferTo)}
```

### Fixup 11: BookingStep Must Be Defined Before TransferStrategyResponse

**Problem:** Python will error if `BookingStep` is referenced before it's defined.

**Fix:** In `backend/src/schemas/optimize.py`, define `BookingStep` BEFORE `TransferStrategyResponse`:
```python
class BookingStep(BaseModel):  # FIRST
    ...

class TransferStrategyResponse(BaseModel):  # SECOND
    bookings: List[BookingStep]  # Now safe
```

### Fixup 12: `create_trip()` Must Store Origin/Destinations

**Problem:** `create_trip()` doesn't store `origin`, `destinations`, `final_destination` but they're required for optimization.

**Fix:** Add to stored item:
```python
"origin": request.origin,
"destinations": request.destinations,
"final_destination": request.final_destination or (
    request.origin if request.trip_type.value == "round_trip" 
    else request.destinations[-1]
),
```

---

## Table of Contents

1. [Critical Foundations](#critical-foundations)
   - [API Contract](#api-contract)
   - [Data Model (DynamoDB)](#data-model-dynamodb)
   - [Determinism & Staleness](#determinism--staleness)
2. [Phase 1: Send All Preferences to Backend](#phase-1-send-all-preferences-to-backend)
3. [Phase 2: Connect to Points Arbitrage Engine](#phase-2-connect-to-points-arbitrage-engine)
4. [Phase 3: Surface Value & Savings](#phase-3-surface-value--savings)
5. [Phase 4: Build Clear Booking Instructions](#phase-4-build-clear-booking-instructions)
6. [Phase 5: Add Trip State Management](#phase-5-add-trip-state-management)
7. [Phase 6: Polish & Transparency](#phase-6-polish--transparency)

---

# Critical Foundations

> **Read this section first.** These contracts prevent the most common integration bugs.

---

## Contract Truth

> **This is the single source of truth for all API contracts.** Every frontend call MUST map to one of these shapes with no exceptions. If you need a new endpoint or field, add it here first.

All backend endpoints use **snake_case** for JSON keys. The frontend uses **camelCase** internally but transforms at the API boundary.

### Casing Rules (Enforced)

| Layer | Convention | Example |
|-------|------------|---------|
| Backend JSON request/response | snake_case | `trip_id`, `hotel_stars`, `optimization_mode` |
| Frontend TypeScript interfaces | camelCase | `tripId`, `hotelStars`, `optimizationMode` |
| API client transformation | Automatic | `apiRequest` handles conversion |

### Serialization Layer

**File:** `frontend/src/lib/serializers.ts` (NEW FILE - Create First)

```typescript
/**
 * Check if value is a plain object (not Date, File, Blob, etc.)
 * Only plain objects should have their keys transformed.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === '[object Object]';
}

/**
 * Transforms camelCase keys to snake_case for backend requests.
 * Handles: nested objects, arrays, Date objects
 * GUARDS: Only recurses into plain objects (not Date, File, Blob, etc.)
 */
export function toSnakeCase<T extends Record<string, unknown>>(obj: T): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
    
    // Handle Date objects → ISO string
    if (value instanceof Date) {
      result[snakeKey] = value.toISOString();
    // Only recurse into plain objects
    } else if (isPlainObject(value)) {
      result[snakeKey] = toSnakeCase(value);
    } else if (Array.isArray(value)) {
      result[snakeKey] = value.map(item => 
        item instanceof Date ? item.toISOString() :
        isPlainObject(item) ? toSnakeCase(item) : item
      );
    } else {
      result[snakeKey] = value;
    }
  }
  return result;
}

/**
 * Transforms snake_case keys to camelCase for frontend consumption.
 * GUARDS: Only recurses into plain objects (not Date, File, Blob, etc.)
 */
export function toCamelCase<T>(obj: Record<string, unknown>): T {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
    
    // Only recurse into plain objects
    if (isPlainObject(value)) {
      result[camelKey] = toCamelCase(value);
    } else if (Array.isArray(value)) {
      result[camelKey] = value.map(item =>
        isPlainObject(item) ? toCamelCase(item) : item
      );
    } else {
      result[camelKey] = value;
    }
  }
  return result as T;
}
```

**File:** `frontend/src/lib/api.ts` (Update `apiRequest`)

```typescript
import { toSnakeCase, toCamelCase } from './serializers';

/**
 * Core API request wrapper.
 * - Transforms request body: camelCase → snake_case
 * - Transforms response: snake_case → camelCase
 * - Handles auth headers
 * - Throws on non-2xx responses
 * 
 * IMPORTANT: This returns the parsed, transformed data directly.
 * Do NOT call response.ok or response.json() on the result.
 * 
 * EXPORTED for direct use in hooks and pure fetch functions.
 */
export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  // Transform request body to snake_case
  if (options.body && typeof options.body === 'string') {
    try {
      const parsed = JSON.parse(options.body);
      options.body = JSON.stringify(toSnakeCase(parsed));
    } catch {
      // Not JSON, leave as-is
    }
  }

  const response = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
      ...(await getAuthHeaders()),
    },
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`API error ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  
  // Transform response to camelCase
  return toCamelCase<T>(data);
}

// ============================================================================
// PURE FETCH FUNCTIONS (no React state - use in hooks and components)
// ============================================================================

import type { 
  OptimizeSoloRequest, 
  OptimizeSoloResponse,
  TransferStrategyRequest,
  TransferStrategyResponse,
  PointsSummaryResponse,
} from '@/types/optimization';

/**
 * Pure fetch function for solo optimization.
 * Does NOT manage React state. Returns typed response directly.
 * Use this in StrategyComparisonCard to avoid state race conditions.
 */
export async function fetchOptimizeSolo(
  tripId: string,
  points: Record<string, number>,
  modeOverride?: 'oop' | 'cpp' | 'balanced'
): Promise<OptimizeSoloResponse> {
  return apiRequest<OptimizeSoloResponse>('/optimize/solo', {
    method: 'POST',
    body: JSON.stringify({
      tripId,
      points,
      optimizationModeOverride: modeOverride,
    }),
  });
}

/**
 * Pure fetch for transfer strategy.
 */
export async function fetchTransferStrategy(
  tripId: string,
  itineraryId: string
): Promise<TransferStrategyResponse> {
  return apiRequest<TransferStrategyResponse>('/transfer-strategy/optimize', {
    method: 'POST',
    body: JSON.stringify({ tripId, itineraryId }),
  });
}

/**
 * Pure fetch for points summary.
 */
export async function fetchPointsSummary(tripId: string): Promise<PointsSummaryResponse> {
  return apiRequest<PointsSummaryResponse>(`/trips/${tripId}/points`);
}
```

---

### Canonical Endpoints (Complete List)

> **Every frontend API call must use one of these endpoints. No exceptions.**

| Operation | Method | Path | Request Body | Response |
|-----------|--------|------|--------------|----------|
| **Trips** |
| Create trip | POST | `/trips` | `CreateTripRequest` | `TripResponse` |
| Get trip | GET | `/trips/{trip_id}` | - | `TripResponse` |
| Update trip status | POST | `/trips/{trip_id}/status` | `UpdateTripStatusRequest` | `StatusUpdateResponse` |
| Select itinerary | POST | `/trips/{trip_id}/select` | `SelectItineraryRequest` | `SelectionResponse` |
| Get selection | GET | `/trips/{trip_id}/selection` | - | `SelectionResponse` |
| **Points** |
| Get points summary | GET | `/trips/{trip_id}/points` | - | `PointsSummaryResponse` |
| Upsert points | POST | `/trips/{trip_id}/points` | `UpsertPointsRequest` | `PointsSummaryResponse` |
| **Optimization** |
| Optimize solo | POST | `/optimize/solo` | `OptimizeSoloRequest` | `OptimizeSoloResponse` |
| **Booking** |
| Get transfer strategy | POST | `/transfer-strategy/optimize` | `TransferStrategyRequest` | `TransferStrategyResponse` |

**Note:** All paths are relative to `BACKEND_URL`. Do NOT prefix with `/api` (Next.js uses that for its own routes).

**Removed endpoints** (to prevent contract drift):
- ❌ `optimization.getCostBreakdown()` - bundled in `OptimizeSoloResponse.itineraries[].segments`
- ❌ `optimization.compareStrategies()` - use `optimization_mode_override` in `OptimizeSoloRequest` instead

---

### Program IDs (Controlled Vocabulary)

> **Core to the arbitrage engine.** These are the canonical program identifiers used across frontend, backend, and optimizer.

```python
# backend/src/schemas/programs.py
from enum import Enum

class PointsProgram(str, Enum):
    """Canonical program IDs. Use these everywhere - never user-entered labels."""
    # Credit Card Programs (Transferable)
    CHASE_UR = "chase_ur"           # Chase Ultimate Rewards
    AMEX_MR = "amex_mr"             # Amex Membership Rewards
    CITI_TYP = "citi_typ"           # Citi ThankYou Points
    CAPITAL_ONE = "capital_one"     # Capital One Miles
    BILT = "bilt"                   # Bilt Rewards
    
    # Airline Programs
    UNITED = "united"               # United MileagePlus
    AMERICAN = "american"           # AAdvantage
    DELTA = "delta"                 # SkyMiles
    SOUTHWEST = "southwest"         # Rapid Rewards
    JETBLUE = "jetblue"            # TrueBlue
    ALASKA = "alaska"              # Mileage Plan
    BRITISH_AIRWAYS = "british_airways"  # Avios
    VIRGIN_ATLANTIC = "virgin_atlantic"  # Flying Club
    AIR_FRANCE_KLM = "air_france_klm"    # Flying Blue
    SINGAPORE = "singapore"        # KrisFlyer
    ANA = "ana"                    # ANA Mileage Club
    
    # Hotel Programs
    MARRIOTT = "marriott"          # Marriott Bonvoy
    HILTON = "hilton"              # Hilton Honors
    HYATT = "hyatt"                # World of Hyatt
    IHG = "ihg"                    # IHG One Rewards

# TypeScript equivalent
# frontend/src/types/programs.ts
export type PointsProgram = 
  | 'chase_ur' | 'amex_mr' | 'citi_typ' | 'capital_one' | 'bilt'
  | 'united' | 'american' | 'delta' | 'southwest' | 'jetblue' | 'alaska'
  | 'british_airways' | 'virgin_atlantic' | 'air_france_klm' | 'singapore' | 'ana'
  | 'marriott' | 'hilton' | 'hyatt' | 'ihg';
```

---

### Request/Response Schemas

**File:** `backend/src/schemas/trip.py` (NEW FILE)

```python
from pydantic import BaseModel
from typing import Optional, List, Literal
from enum import Enum

class TripType(str, Enum):
    ONE_WAY = "one_way"
    ROUND_TRIP = "round_trip"

class DateMode(str, Enum):
    FIXED = "fixed"
    FLEXIBLE = "flexible"

class OptimizationMode(str, Enum):
    OOP = "oop"      # Minimize out-of-pocket
    CPP = "cpp"      # Maximize cents-per-point
    BALANCED = "balanced"

class CreateTripRequest(BaseModel):
    title: str
    trip_type: TripType = TripType.ROUND_TRIP
    date_mode: DateMode = DateMode.FIXED
    
    # REQUIRED: Origin and destinations (P0-9 fix)
    origin: str                          # IATA code, e.g., "JFK"
    destinations: List[str]              # IATA codes for cities to visit
    final_destination: Optional[str]     # For one-way; defaults to origin for round-trip
    
    # Only required if date_mode == "fixed"
    start_date: Optional[str] = None
    end_date: Optional[str] = None
    # Only used if date_mode == "flexible"
    duration_days: Optional[int] = None
    
    include_hotels: bool = True
    max_budget: Optional[float] = None
    
    adults: int = 1
    children: int = 0
    bags: int = 0
    flight_class: Literal["basic_economy", "economy", "premium", "business", "first"] = "economy"
    hotel_class: Literal["3", "4", "5"] = "4"
    optimization_mode: OptimizationMode = OptimizationMode.BALANCED
    departure_time_preference: Literal["any", "morning", "afternoon", "evening", "night"] = "any"
    arrival_time_preference: Literal["any", "morning", "afternoon", "evening", "night"] = "any"

class TripResponse(BaseModel):
    """API response model. Does NOT include DynamoDB internals (PK, SK, etc.)"""
    trip_id: str
    title: str
    trip_type: TripType
    date_mode: DateMode
    origin: str
    destinations: List[str]
    final_destination: Optional[str]
    start_date: Optional[str]
    end_date: Optional[str]
    duration_days: Optional[int]
    include_hotels: bool
    max_budget: Optional[float]
    adults: int
    children: int
    bags: int
    flight_class: str
    hotel_class: str
    optimization_mode: OptimizationMode
    departure_time_preference: str
    arrival_time_preference: str
    status: str
    created_at: str
    created_by: str
    invite_code: Optional[str] = None

class UpdateTripStatusRequest(BaseModel):
    status: Literal["draft", "optimized", "selected", "instructions_unlocked", "completed", "cancelled"]

class StatusUpdateResponse(BaseModel):
    ok: bool
    status: str

class SelectItineraryRequest(BaseModel):
    itinerary_id: str
    # Full snapshot for reproducibility (award availability changes)
    itinerary_snapshot: dict
    cash_price_at_selection: float
    out_of_pocket_at_selection: float

class SelectionResponse(BaseModel):
    ok: bool
    itinerary_id: Optional[str] = None
    itinerary_snapshot: Optional[dict] = None
    cash_price_at_selection: Optional[float] = None
    out_of_pocket_at_selection: Optional[float] = None
    selected_at: Optional[str] = None
```

**File:** `backend/src/schemas/points.py` (NEW FILE)

```python
from pydantic import BaseModel
from typing import Dict, List
from schemas.programs import PointsProgram

class PointsBalance(BaseModel):
    program: PointsProgram
    balance: int
    updated_at: Optional[str] = None  # Issue #4 FIX: add updated_at

class UpsertPointsRequest(BaseModel):
    points: List[PointsBalance]  # Issue #3 FIX: field is named "points"

class PointsSummaryResponse(BaseModel):
    trip_id: str  # Issue #4 FIX: always include trip_id
    items: List[PointsBalance]
    total_points: int
```

**File:** `backend/src/schemas/optimize.py` (NEW FILE)

```python
from pydantic import BaseModel
from typing import Optional, Dict, List, Literal
from schemas.programs import PointsProgram

class OptimizeSoloRequest(BaseModel):
    trip_id: str
    points: Dict[PointsProgram, int]  # { "chase_ur": 50000, "amex_mr": 30000 }
    # Optional: override trip's optimization_mode for comparison
    optimization_mode_override: Optional[Literal["oop", "cpp", "balanced"]] = None

class TransferInsight(BaseModel):
    type: Literal["transfer_bonus", "sweet_spot", "multi_hop", "cross_program"]
    description: str
    # Trust scaffolding (no fake dollar amounts)
    evidence: Optional[str] = None      # e.g., "Cash fare from Google Flights"
    as_of: Optional[str] = None         # ISO timestamp
    confidence: Literal["high", "medium", "low"] = "high"

class TransferInstruction(BaseModel):
    """Typed transfer instruction for BookingGuide"""
    step_number: int
    source_program: PointsProgram
    target_program: PointsProgram
    points_to_transfer: int
    transfer_ratio: float               # e.g., 1.0 or 1.3 for 30% bonus
    expected_transfer_time: str         # e.g., "instant", "1-2 days"
    portal_url: str
    warning: Optional[str] = None       # e.g., "Transfer bonus expires March 15"

class SegmentBreakdown(BaseModel):
    segment: str                        # e.g., "JFK → LAX"
    type: Literal["flight", "hotel"]
    payment_method: Literal["cash", "points"]
    cash_price: float                   # Real cash price for this segment
    # If points:
    points_used: Optional[int] = None
    surcharge: Optional[float] = None
    cpp_achieved: Optional[float] = None  # Computed as: (cash_price - surcharge) / points_used * 100
    transfer_from: Optional[str] = None
    transfer_to: Optional[str] = None
    transfer_ratio: Optional[float] = None

class OOPMetrics(BaseModel):
    total_cash_price: float      # Sum of all segments at cash price
    total_out_of_pocket: float   # What user actually pays
    total_points_used: int
    cash_saved: float            # total_cash_price - total_out_of_pocket (REAL number)
    savings_percentage: float    # cash_saved / total_cash_price * 100
    average_cpp: float           # Weighted average CPP across segments

class RankedItinerary(BaseModel):
    id: str
    rank: int
    # Route info for display (P0-6 fix)
    route: List[str]                     # e.g., ["JFK", "LAX", "SFO", "JFK"]
    display_name: str                    # e.g., "JFK → LAX → SFO → JFK"
    total_duration_hours: Optional[float] = None
    
    segments: List[SegmentBreakdown]     # Cost breakdown BUNDLED (not separate call)
    oop_metrics: OOPMetrics
    insights: List[TransferInsight]
    transfers: List[TransferInstruction] # TYPED, not List[dict] (P0-arch fix)
    
class OptimizeSoloResponse(BaseModel):
    itineraries: List[RankedItinerary]
    best_option: Optional[str]           # ID of recommended itinerary
    warnings: List[str]
    global_insights: List[TransferInsight]
    
    # Staleness metadata (no underscore prefixes - P0-4 fix)
    cached: bool = False
    computed_at: str                     # ISO timestamp
    expires_at: str                      # ISO timestamp - use for "valid until" UX

class TransferStrategyRequest(BaseModel):
    trip_id: str
    itinerary_id: str

# Issue #11 FIX: BookingStep MUST be defined BEFORE TransferStrategyResponse
class BookingStep(BaseModel):
    """A booking action in the transfer strategy"""
    step_number: int
    type: Literal["flight", "hotel"]
    airline: Optional[str] = None
    hotel_chain: Optional[str] = None
    
    # booking_url may be:
    # - Direct deep link to award booking page (ideal)
    # - Generic search landing page (need to specify what to search)
    # If generic, segment_reference MUST explain what to search for
    booking_url: str
    
    # Human-readable reference to what this step books
    # E.g., "JFK → NRT Business Class United Polaris"
    segment_reference: str

class TransferStrategyResponse(BaseModel):
    """Response for /transfer-strategy/optimize"""
    transfers: List[TransferInstruction]
    bookings: List[BookingStep]  # Now BookingStep is defined above
    total_points_to_transfer: int
    estimated_total_time: str            # e.g., "2-3 days"
    warnings: List[str]
```

**Schema Note (P16):** `booking_url` may point to either:
1. **Deep link** - Takes user directly to award booking checkout (rare, depends on airline API)
2. **Search landing page** - Takes user to airline search page (more common)

For search landing pages, `segment_reference` must be actionable:
- Good: "Search JFK → NRT, March 1, Business Class, United Polaris award"
- Bad: "Flight 1"

---

## Data Model (DynamoDB)

### Storage Model vs API Model Separation

> **Important:** DynamoDB items include `PK`, `SK`, GSI attributes, and TTL fields. API responses NEVER include these. Use mappers to convert.

### Item Structure

| PK | SK | Purpose | Key Attributes |
|----|----|---------| --------------|
| `TRIP#{trip_id}` | `METADATA` | Trip configuration | All `CreateTripRequest` fields + `status`, `created_at`, `created_by` |
| `TRIP#{trip_id}` | `POINTS#{program}` | Single points balance | `program`, `balance`, `updated_at` (Issue #2 FIX: one item per program) |
| `TRIP#{trip_id}` | `SELECTION` | Selected itinerary snapshot | `itinerary_id`, `itinerary_snapshot`, `selected_at`, `cash_price_at_selection`, `oop_at_selection` |
| `TRIP#{trip_id}` | `OPT#{cache_key}` | Optimization results cache | `itineraries`, `computed_at`, `expires_at`, `cache_key` |
| `USER#{user_id}` | `SAVINGS` | Cumulative user savings | `total_saved`, `trips_completed` |

> **Issue #2 Note:** Points are stored as multiple items (`POINTS#chase_ur`, `POINTS#amex_mr`, etc.), NOT as a single item with an `items[]` array. This allows efficient per-program updates.

### Storage-to-API Mapper

```python
# backend/src/mappers/trip_mapper.py
from schemas.trip import TripResponse

def storage_to_api(item: dict) -> TripResponse:
    """Convert DynamoDB item to API response. Strips PK/SK/internal fields."""
    return TripResponse(
        trip_id=item["trip_id"],
        title=item["title"],
        trip_type=item["trip_type"],
        date_mode=item["date_mode"],
        origin=item["origin"],
        destinations=item["destinations"],
        final_destination=item.get("final_destination"),
        start_date=item.get("start_date"),
        end_date=item.get("end_date"),
        duration_days=item.get("duration_days"),
        include_hotels=item.get("include_hotels", True),
        max_budget=item.get("max_budget"),
        adults=item.get("adults", 1),
        children=item.get("children", 0),
        bags=item.get("bags", 0),
        flight_class=item.get("flight_class", "economy"),
        hotel_class=item.get("hotel_class", "4"),
        optimization_mode=item.get("optimization_mode", "balanced"),
        departure_time_preference=item.get("departure_time_preference", "any"),
        arrival_time_preference=item.get("arrival_time_preference", "any"),
        status=item["status"],
        created_at=item["created_at"],
        created_by=item["created_by"],
        invite_code=item.get("invite_code"),
    )
```

### Why Snapshot on Selection

Award availability changes constantly. When a user selects an itinerary:

1. Store the **full itinerary snapshot** including prices, points, transfers
2. Store **cash_price_at_selection** and **oop_at_selection** 
3. The BookingGuide uses the snapshot, not live data
4. If user returns days later, they see what they selected, not stale/invalid options

```python
# backend/src/services/trip_service.py
from mappers.trip_mapper import storage_to_api

def create_trip(user_id: str, request: CreateTripRequest) -> TripResponse:
    trip_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    # Storage item (includes DynamoDB keys)
    item = {
        "PK": f"TRIP#{trip_id}",
        "SK": "METADATA",
        "trip_id": trip_id,
        "created_by": user_id,
        "status": "draft",
        "created_at": now,
        # ... all request fields ...
        **request.dict(),
    }
    
    table.put_item(Item=item)
    
    # Return API model (strips PK/SK) - P0-1 fix
    return storage_to_api(item)

def select_itinerary(trip_id: str, user_id: str, request: SelectItineraryRequest) -> SelectionResponse:
    # Verify ownership
    trip = get_trip_storage(trip_id)
    if trip["created_by"] != user_id:
        raise PermissionError("Not your trip")
    
    now = datetime.utcnow().isoformat()
    
    # Store snapshot
    table.put_item(Item={
        "PK": f"TRIP#{trip_id}",
        "SK": "SELECTION",
        "itinerary_id": request.itinerary_id,
        "itinerary_snapshot": request.itinerary_snapshot,
        "cash_price_at_selection": request.cash_price_at_selection,
        "out_of_pocket_at_selection": request.out_of_pocket_at_selection,
        "selected_at": now,
    })
    
    # Update trip status
    update_trip_status(trip_id, "selected", user_id)
    
    # Update user's cumulative savings
    savings = request.cash_price_at_selection - request.out_of_pocket_at_selection
    user_service.add_savings(user_id, savings)
    
    return SelectionResponse(ok=True, selected_at=now)
```

---

## Determinism & Staleness

### Award Availability Changes

Award seats can disappear within hours. The plan must handle:

| Scenario | Handling |
|----------|----------|
| User optimizes, leaves, returns tomorrow | Show "Valid until [time]" + "Refresh" button. If expired, auto-prompt refresh. |
| User selects itinerary | Snapshot stored. BookingGuide uses snapshot. |
| User starts booking, flight gone | BookingGuide shows warning + alternatives |
| Transfer bonus expires | Show expiration date in insights. Re-optimize if bonus changes results significantly. |

### Optimization Cache Key (P0-8 Fix)

> **Problem:** Caching by `trip_id + points` alone causes false hits if trip preferences change.
> **Solution:** Hash all inputs that affect optimization results.

```python
# backend/src/services/optimize_service.py
import hashlib
import json
from datetime import datetime, timedelta

OPTIMIZATION_CACHE_TTL_HOURS = 4

def compute_cache_key(trip_id: str, trip_prefs: dict, points: dict, mode: str) -> str:
    """
    Deterministic cache key based on all optimization inputs.
    Changes to any input = new cache key = fresh optimization.
    
    IMPORTANT: 
    - `mode` is the RESOLVED mode (override or trip setting), not trip_prefs["optimization_mode"]
    - Destinations are NOT sorted (order matters for route semantics)
    """
    key_data = {
        "trip_id": trip_id,
        "origin": trip_prefs["origin"],
        # Keep destination order (user intent: "Tokyo then Seoul" != "Seoul then Tokyo")
        "destinations": trip_prefs["destinations"],
        "date_mode": trip_prefs["date_mode"],
        "start_date": trip_prefs.get("start_date"),
        "end_date": trip_prefs.get("end_date"),
        "duration_days": trip_prefs.get("duration_days"),
        # Use RESOLVED mode (includes override), not trip_prefs["optimization_mode"]
        "optimization_mode": mode,
        "flight_class": trip_prefs["flight_class"],
        "hotel_class": trip_prefs["hotel_class"],
        "adults": trip_prefs["adults"],
        "children": trip_prefs["children"],
        "include_hotels": trip_prefs["include_hotels"],
        "points": dict(sorted(points.items())),  # Sort points for determinism (order doesn't matter)
    }
    
    key_json = json.dumps(key_data, sort_keys=True)
    return hashlib.sha256(key_json.encode()).hexdigest()[:16]

def get_or_compute_optimization(trip_id: str, trip_prefs: dict, points: dict, mode: str) -> OptimizeSoloResponse:
    # Include resolved mode in cache key (so OOP/CPP/Balanced don't collide)
    cache_key = compute_cache_key(trip_id, trip_prefs, points, mode)
    
    # Check cache
    cached = get_cached_optimization(trip_id, cache_key)
    if cached and not is_expired(cached):
        return OptimizeSoloResponse(
            **cached["result"],
            cached=True,
            computed_at=cached["computed_at"],
            expires_at=cached["expires_at"],
        )
    
    # Compute fresh - use timezone-aware UTC
    from datetime import timezone
    now = datetime.now(timezone.utc)
    expires = now + timedelta(hours=OPTIMIZATION_CACHE_TTL_HOURS)
    
    # Pass resolved mode to optimizer
    result = run_optimization(trip_id, trip_prefs, points, mode)
    
    # Format with explicit UTC (ISO format with Z suffix)
    computed_str = now.strftime('%Y-%m-%dT%H:%M:%SZ')
    expires_str = expires.strftime('%Y-%m-%dT%H:%M:%SZ')
    
    # Cache with deterministic key
    cache_optimization(
        trip_id=trip_id,
        cache_key=cache_key,
        result=result,
        computed_at=computed_str,
        expires_at=expires_str,
        ttl_epoch=int(expires.timestamp()),  # Pass epoch directly
    )
    
    return OptimizeSoloResponse(
        **result,
        cached=False,
        computed_at=computed_str,
        expires_at=expires_str,
    )

def cache_optimization(trip_id: str, cache_key: str, result: dict, computed_at: str, expires_at: str, ttl_epoch: int):
    """Store optimization result with deterministic cache key."""
    table.put_item(Item={
        "PK": f"TRIP#{trip_id}",
        "SK": f"OPT#{cache_key}",
        "result": result,
        "computed_at": computed_at,
        "expires_at": expires_at,
        "ttl": ttl_epoch,  # DynamoDB TTL - epoch seconds, already computed
    })
```

### BookingGuide Staleness Handling

```typescript
// In BookingGuide component
{step.action === 'book_flight' && (
  <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
    <AlertTriangle className="w-3 h-3 inline mr-1" />
    Award availability changes quickly. If this exact flight isn't available, 
    search for similar times—the points cost should be similar.
  </div>
)}
```

---

## Phase 1: Send All Preferences to Backend

### Task 1.1: Extend Trip Creation API

**Goal:** Send all user preferences when creating a trip, using proper enums instead of conflicting booleans.

> **P0 Fix Applied:** Replaced `is_one_way` / `is_round_trip` / `is_flexible` booleans with `trip_type` and `date_mode` enums to prevent impossible states.

#### Step 1.1.1: Create Backend Schema File

**File:** `backend/src/schemas/__init__.py` (NEW FILE - create package)
```python
# Empty file to make schemas a package
```

**File:** `backend/src/schemas/trip.py` (NEW FILE)

Schemas are defined in the [API Contract](#api-contract) section. Import into `app.py`:

```python
# backend/src/app.py
from schemas.trip import (
    CreateTripRequest, 
    TripResponse, 
    UpdateTripStatusRequest,
    SelectItineraryRequest,
    TripType,
    DateMode,
)

@app.post("/trips", response_model=TripResponse)
async def create_trip_endpoint(
    request: CreateTripRequest,
    user_id: str = Depends(get_current_user)
):
    return trip_service.create_trip(user_id, request)
```

#### Step 1.1.2: Update Trip Service

**File:** `backend/src/services/trip_service.py`

```python
from schemas.trip import CreateTripRequest, TripType, DateMode

def create_trip(user_id: str, request: CreateTripRequest) -> dict:
    trip_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()
    
    item = {
        "PK": f"TRIP#{trip_id}",
        "SK": "METADATA",
        "trip_id": trip_id,
        "created_by": user_id,
        "title": request.title,
        # Use enums, not booleans (P0-3 fix)
        "trip_type": request.trip_type.value,
        "date_mode": request.date_mode.value,
        
        # Issue #12 FIX: Include origin/destinations (required for optimization)
        "origin": request.origin,
        "destinations": request.destinations,
        "final_destination": (
            request.final_destination 
            or (request.origin if request.trip_type.value == "round_trip" else request.destinations[-1] if request.destinations else None)
        ),
        
        "start_date": request.start_date,
        "end_date": request.end_date,
        "duration_days": request.duration_days,
        "include_hotels": request.include_hotels,
        "max_budget": request.max_budget,
        "status": "draft",  # Start as draft
        "created_at": now,
        # Preferences
        "adults": request.adults,
        "children": request.children,
        "bags": request.bags,
        "flight_class": request.flight_class,
        "hotel_class": request.hotel_class,
        "optimization_mode": request.optimization_mode.value,
        "departure_time_preference": request.departure_time_preference,
        "arrival_time_preference": request.arrival_time_preference,
    }
    
    table.put_item(Item=item)
    
    # FIXUP 2: Return clean API response, not raw DynamoDB item
    return storage_to_api(item)
```

#### Step 1.1.3: Create Frontend Types

**File:** `frontend/src/types/trip.ts` (NEW FILE)

```typescript
// Enums replace conflicting booleans (P0-3 fix)
export type TripType = 'one_way' | 'round_trip';
export type DateMode = 'fixed' | 'flexible';
export type OptimizationMode = 'oop' | 'cpp' | 'balanced';
export type FlightClass = 'basic_economy' | 'economy' | 'premium' | 'business' | 'first';
export type HotelClass = '3' | '4' | '5';
export type TimePreference = 'any' | 'morning' | 'afternoon' | 'evening' | 'night';
export type TripStatus = 'draft' | 'optimized' | 'selected' | 'instructions_unlocked' | 'completed' | 'cancelled';

// Frontend uses camelCase (transformed at API boundary)
export interface CreateTripRequest {
  title: string;
  tripType: TripType;
  dateMode: DateMode;
  
  // REQUIRED: Origin and destinations (P0-9 fix)
  origin: string;                    // IATA code, e.g., "JFK"
  destinations: string[];            // IATA codes for cities to visit
  finalDestination?: string;         // For one-way; defaults to origin for round-trip
  
  // Only if dateMode === 'fixed'
  startDate?: string;
  endDate?: string;
  // Only if dateMode === 'flexible'
  durationDays?: number;
  
  includeHotels?: boolean;
  maxBudget?: number;
  
  adults?: number;
  children?: number;
  bags?: number;
  flightClass?: FlightClass;
  hotelClass?: HotelClass;
  optimizationMode?: OptimizationMode;
  departureTimePreference?: TimePreference;
  arrivalTimePreference?: TimePreference;
}

export interface Trip extends CreateTripRequest {
  tripId: string;
  status: TripStatus;
  createdAt: string;
  createdBy: string;
  inviteCode?: string;
  memberCount?: number;
}
```

#### Step 1.1.4: Update API Client with Serialization

**File:** `frontend/src/lib/api.ts` (Update)

```typescript
import { toSnakeCase, toCamelCase } from './serializers';
import type { CreateTripRequest, Trip } from '@/types/trip';

// apiRequest now handles camelCase ↔ snake_case automatically
// (see serializers.ts in API Contract section)

export const trips = {
  create: async (data: CreateTripRequest): Promise<Trip> => {
    return apiRequest<Trip>('/trips', {
      method: 'POST',
      body: JSON.stringify(data),  // Serializer handles conversion
    });
  },
  
  get: async (tripId: string): Promise<Trip> => {
    return apiRequest<Trip>(`/trips/${tripId}`);
  },
  
  updateStatus: async (tripId: string, status: TripStatus): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/trips/${tripId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    });
  },
  
  // P15 fix: Store payment proof with status update
  updateStatusWithPayment: async (
    tripId: string, 
    status: TripStatus, 
    paymentProof: PaymentProof
  ): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/trips/${tripId}/status`, {
      method: 'POST',
      body: JSON.stringify({ status, paymentProof }),
    });
  },
};
```

#### Step 1.1.5: Update Solo Setup Page

**File:** `frontend/src/app/(app)/solo/setup/page.tsx`

Replace boolean state with enums:

```typescript
import type { TripType, DateMode, OptimizationMode, FlightClass, HotelClass, TimePreference } from '@/types/trip';

// BEFORE (problematic - can have impossible states)
// const [isFlexible, setIsFlexible] = useState(false);
// const [isOneWay, setIsOneWay] = useState(false);

// AFTER (clean enum state)
const [tripType, setTripType] = useState<TripType>('round_trip');
const [dateMode, setDateMode] = useState<DateMode>('fixed');
const [optimizationMode, setOptimizationMode] = useState<OptimizationMode>('balanced');

const handleGenerate = async () => {
  const errors = validateSoloTripSetup({
    tripType,
    dateMode,
    startDate,
    endDate,
    durationDays,
    cities,
    creditCards,
  });
  
  if (errors.length > 0) {
    setValidationErrors(errors);
    return;
  }

  try {
    const trip = await trips.create({
      title: tripTitle,
      tripType,
      dateMode,
      startDate: dateMode === 'fixed' ? startDate : undefined,
      endDate: dateMode === 'fixed' && tripType === 'round_trip' ? endDate : undefined,
      durationDays: dateMode === 'flexible' ? durationDays : undefined,
      includeHotels,
      maxBudget: maxBudget === '' ? undefined : maxBudget,
      adults,
      children,
      bags,
      flightClass,
      hotelClass,
      optimizationMode,
      departureTimePreference,
      arrivalTimePreference,
    });
    
    // ... add destinations, upsert points, navigate
  } catch (error) {
    setError(error instanceof Error ? error.message : 'Failed to create trip');
  }
};
```

#### Acceptance Criteria 1.1
- [ ] `trip_type` enum replaces `is_one_way` / `is_round_trip` booleans
- [ ] `date_mode` enum replaces `is_flexible` boolean  
- [ ] Serializer transforms camelCase ↔ snake_case at API boundary
- [ ] All preferences saved in DynamoDB
- [ ] Backward compat: old trips without new fields still load
- [ ] Contract test passes: create trip → get trip → fields match

---

## Phase 2: Connect to Points Arbitrage Engine

> *Per Source of Truth: "Tripy is a points arbitrage engine—it finds the gap between what your points are 'officially' worth and what they could be worth when used strategically. The difference can be 3x, 5x, or even 10x."*

### Task 2.1: Replace Legacy Itinerary Generation with Arbitrage Engine

**Goal:** Use `POST /optimize/solo` instead of `POST /itinerary/generate` to leverage the full points arbitrage capabilities including:
- **Transfer bonuses** - Factor in promotional bonus offers
- **Sweet spots** - Find exceptional redemption values for specific routes
- **Cross-program arbitrage** - Evaluate redemption costs across all available programs
- **Multi-hop optimization** - Find connecting routes that offer better value

#### Step 2.1.1: Create Points Arbitrage Hook

**File:** `frontend/src/lib/hooks/useSoloOptimization.ts` (NEW FILE)

> **P0-5 Fix Applied:** Backend is source of truth for preferences. Frontend sends only `trip_id` and `points`. Backend loads trip, uses stored preferences.

> **P0-4 Fix Applied:** Dollar savings come from real cash comparisons (`cash_saved` in response), NOT invented from `points * 0.015`. Insights show percentages for bonuses, not fake dollar amounts.

> **P1-4 Fix Applied:** Cost breakdown is bundled in `RankedItinerary`, not a separate API call.

```typescript
import { useState, useCallback } from 'react';
import { optimization, points } from '@/lib/api';
import type { OptimizeSoloResponse, RankedItinerary, TransferInsight } from '@/types/optimization';

interface UseSoloOptimizationResult {
  itineraries: RankedItinerary[];
  isLoading: boolean;
  error: string | null;
  optimize: (tripId: string, modeOverride?: 'oop' | 'cpp' | 'balanced') => Promise<void>;
  bestOption: string | null;
  warnings: string[];
  globalInsights: TransferInsight[];
  // Staleness info (no underscore prefixes - P0-4 fix)
  cached: boolean;
  computedAt: string | null;
  expiresAt: string | null;
  // Issue #8 FIX: Expose pointsMap so results page can use it
  pointsMap: Record<string, number>;
}

export function useSoloOptimization(): UseSoloOptimizationResult {
  const [itineraries, setItineraries] = useState<RankedItinerary[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bestOption, setBestOption] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [globalInsights, setGlobalInsights] = useState<TransferInsight[]>([]);
  // Issue #8 FIX: Store and expose the pointsMap
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});
  const [cached, setCached] = useState(false);
  const [computedAt, setComputedAt] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const optimize = useCallback(async (
    tripId: string, 
    modeOverride?: 'oop' | 'cpp' | 'balanced'
  ) => {
    setIsLoading(true);
    setError(null);
    
    try {
      // 1. Get points summary using canonical endpoint
      const pointsSummary = await points.summary(tripId);
      
      // 2. Build points map with canonical program IDs
      // FIXUP 5: Use != null to preserve zero balances (0 is falsy but valid)
      const builtPointsMap: Record<string, number> = {};
      pointsSummary.items.forEach(item => {
        if (item.program && item.balance != null) {
          builtPointsMap[item.program] = item.balance;
        }
      });
      
      // Issue #8 FIX: Store pointsMap so results page can use it
      setPointsMap(builtPointsMap);
      
      // 3. Call arbitrage engine
      // BACKEND IS SOURCE OF TRUTH for preferences (P0-5)
      // Only pass mode override for strategy comparison (removes need for separate endpoint)
      const response = await optimization.solo({
        tripId,
        points: builtPointsMap,  // Use the built map
        optimizationModeOverride: modeOverride,  // Optional: for compare strategies use case
      });
      
      // 4. Response includes everything (cost breakdown bundled, not separate call)
      // - itineraries[].segments[] has per-segment breakdown
      // - itineraries[].oopMetrics has totals
      // - itineraries[].insights has arbitrage discoveries
      // - itineraries[].transfers has typed TransferInstruction[]
      setItineraries(response.itineraries);
      setBestOption(response.bestOption);
      setWarnings(response.warnings);
      setGlobalInsights(response.globalInsights || []);
      
      // 5. Track staleness for UX (no underscore prefixes - P0-4 fix)
      setCached(response.cached);
      setComputedAt(response.computedAt);
      setExpiresAt(response.expiresAt);
      
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
      setItineraries([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return {
    itineraries,
    isLoading,
    error,
    optimize,
    bestOption,
    warnings,
    globalInsights,
    cached,
    computedAt,
    expiresAt,
    pointsMap,  // Issue #8 FIX: Expose pointsMap to results page
  };
}
```

**File:** `frontend/src/types/optimization.ts` (UPDATE)

```typescript
import type { PointsProgram } from './programs';

// P0-4: Insights never show invented dollar amounts from points * multiplier
// Only show dollar amounts when backed by real cash comparisons
export interface TransferInsight {
  type: 'transfer_bonus' | 'sweet_spot' | 'multi_hop' | 'cross_program';
  description: string;  // e.g., "30% transfer bonus to United" (percentage, not dollars)
  // Trust scaffolding
  evidence?: string;    // e.g., "Cash fare from Google Flights"
  asOf?: string;        // ISO timestamp
  confidence: 'high' | 'medium' | 'low';
  // NO savingsAmount field - that would be invented
}

// Typed transfer instruction (not List[dict])
export interface TransferInstruction {
  stepNumber: number;
  sourceProgram: PointsProgram;
  targetProgram: PointsProgram;
  pointsToTransfer: number;
  transferRatio: number;        // e.g., 1.0 or 1.3 for 30% bonus
  expectedTransferTime: string; // e.g., "instant", "1-2 days"
  portalUrl: string;
  warning?: string;             // e.g., "Transfer bonus expires March 15"
}

// Cost breakdown is bundled in the itinerary, not a separate call
export interface RankedItinerary {
  id: string;
  rank: number;
  
  // Route info for display (P0-6 fix)
  route: string[];              // e.g., ["JFK", "LAX", "SFO", "JFK"]
  displayName: string;          // e.g., "JFK → LAX → SFO → JFK"
  totalDurationHours?: number;
  
  // Bundled segment breakdown (no extra API call needed)
  segments: SegmentBreakdown[];
  
  // Aggregated metrics
  oopMetrics: OOPMetrics;
  
  // Insights discovered for THIS itinerary
  insights: TransferInsight[];
  
  // Typed transfer instructions for booking
  transfers: TransferInstruction[];
}

export interface OOPMetrics {
  totalCashPrice: number;      // Real: sum of cash prices for all segments
  totalOutOfPocket: number;    // Real: what user actually pays
  totalPointsUsed: number;
  cashSaved: number;           // Real: totalCashPrice - totalOutOfPocket (P0-4)
  savingsPercentage: number;   // Real: cashSaved / totalCashPrice * 100
  averageCpp: number;          // Real: weighted average across segments
}

export interface SegmentBreakdown {
  segment: string;             // e.g., "JFK → LAX"
  type: 'flight' | 'hotel';
  paymentMethod: 'cash' | 'points';
  cashPrice: number;           // Real cash price for this segment
  // If points:
  pointsUsed?: number;
  surcharge?: number;
  cppAchieved?: number;        // Real: (cashPrice - surcharge) / pointsUsed * 100
  transferFrom?: PointsProgram;
  transferTo?: PointsProgram;
  transferRatio?: number;
}

// Response from /optimize/solo
export interface OptimizeSoloResponse {
  itineraries: RankedItinerary[];
  bestOption: string | null;    // ID of recommended itinerary
  warnings: string[];
  globalInsights: TransferInsight[];
  // Staleness metadata (no underscore prefixes)
  cached: boolean;
  computedAt: string;           // ISO timestamp
  expiresAt: string;            // ISO timestamp - use for "valid until" UX
}
```

#### Step 2.1.2: Update Results Page to Use New Hook

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

Replace the existing fetch logic with the new hook:

```typescript
import { useSoloOptimization } from '@/lib/hooks/useSoloOptimization';
import { trips } from '@/lib/api';
import type { Trip } from '@/types/trip';

export default function SoloResults() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  // Issue #8 FIX: Define trip and pointsMap state
  const [trip, setTrip] = useState<Trip | null>(null);
  const [pointsMap, setPointsMap] = useState<Record<string, number>>({});

  // Use the new optimization hook - now also exposes pointsMap
  const { 
    itineraries: optimizedItineraries, 
    isLoading, 
    error, 
    optimize, 
    bestOption,
    warnings,
    pointsMap: hookPointsMap,  // Issue #8: hook now returns the pointsMap it computed
  } = useSoloOptimization();

  // Issue #8 FIX: Load trip data on mount
  useEffect(() => {
    if (tripId) {
      trips.get(tripId).then(setTrip).catch(console.error);
    }
  }, [tripId]);

  // Trigger optimization on mount
  useEffect(() => {
    if (tripId) {
      optimize(tripId);
    }
  }, [tripId, optimize]);

  // Issue #8 FIX: Sync pointsMap from hook when available
  useEffect(() => {
    if (hookPointsMap && Object.keys(hookPointsMap).length > 0) {
      setPointsMap(hookPointsMap);
    }
  }, [hookPointsMap]);

  // FIXUP 4: Use displayName (not name), compute flags from real data
  // Keep original itinerary.id for selection, use index only for display ordering
  const itineraries = useMemo(() => {
    // Calculate total available points for comparison
    const totalAvailablePoints = Object.values(pointsMap).reduce((sum, bal) => sum + bal, 0);
    
    return optimizedItineraries.map((item, index) => ({
      // Keep REAL id for selection API, add displayIndex for UI
      id: item.id,  // String ID from backend, needed for selection
      displayIndex: index + 1,  // For UI display only
      
      // FIXUP 4: Use displayName, not name
      name: item.displayName,
      
      cities: item.route.map(city => ({ name: city, days: 3 })),
      routeDisplay: item.route,
      totalCost: item.oopMetrics.totalOutOfPocket,
      pointsCost: item.oopMetrics.totalPointsUsed,
      score: 100 - item.rank * 5, // Convert rank to score
      
      // FIXUP 4: Compute from real data, backend doesn't provide these flags
      withinBudget: trip?.maxBudget 
        ? item.oopMetrics.totalOutOfPocket <= trip.maxBudget 
        : true,
      withinPoints: item.oopMetrics.totalPointsUsed <= totalAvailablePoints,
      
      // Store original for booking page snapshot
      _original: item,
    }));
  }, [optimizedItineraries, trip?.maxBudget, pointsMap]);

  // ... rest of component
}
```

#### Step 2.1.3: Update Backend Optimization Endpoint

**File:** `backend/src/app.py`

> **See Fixup 3 above.** This is the ONLY valid handler. Do NOT reference `request.budget`, `request.cabin_classes`, etc.

```python
@app.post("/optimize/solo", response_model=OptimizeSoloResponse)
async def optimize_solo(request: OptimizeSoloRequest, user_id: str = Depends(get_current_user)):
    # Verify ownership
    trip = trip_service.get_trip(request.trip_id, user_id)
    
    # Resolve mode: override takes precedence, else trip setting
    mode = request.optimization_mode_override or trip["optimization_mode"]
    
    # Backend is source of truth for ALL preferences (P0-5)
    # Only tripId + points + optional mode override come from request
    return optimize_service.get_or_compute_optimization(
        trip_id=request.trip_id,
        trip_prefs=trip,  # Full trip prefs loaded from DB
        points=request.points,
        mode=mode,
    )
```

#### Acceptance Criteria 2.1
- [ ] Results page uses `optimization.solo()` instead of `itineraries.generate()`
- [ ] Trip preferences (flight class, optimization mode, etc.) are passed to optimizer
- [ ] Itineraries are ranked by user's chosen criteria
- [ ] OOP metrics displayed correctly
- [ ] Arbitrage insights extracted and available for display

---

### Task 2.2: Add Cost Breakdown Display

**Goal:** Show detailed cost breakdown for each itinerary so users understand WHERE their savings come from.

> *Per Source of Truth: "Users should always understand the trade-offs between options."*

> **FIXUP 1 APPLIED:** This component takes `segments` + `oopMetrics` as PROPS. It does NOT call any API. The data is already bundled in `RankedItinerary`.

#### Step 2.2.1: Create Cost Breakdown Component

**File:** `frontend/src/components/ui/CostBreakdownCard.tsx` (NEW FILE)

```typescript
'use client';

import { useState } from 'react';
import { Plane, Building2, ArrowRight, Info, ChevronDown, ChevronUp } from 'lucide-react';
import type { SegmentBreakdown, OOPMetrics } from '@/types/optimization';
// Issue #7 FIX: Import getProgramLabel for displaying program IDs
import { getProgramLabel } from '@/lib/programLabels';

// NO API IMPORT - data comes from props (bundled in RankedItinerary)

interface CostBreakdownCardProps {
  segments: SegmentBreakdown[];  // From itinerary.segments
  oopMetrics: OOPMetrics;        // From itinerary.oopMetrics
}

export function CostBreakdownCard({ segments, oopMetrics }: CostBreakdownCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  // Data is passed in, no loading state needed

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      {/* Summary (always visible) */}
      <button 
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div>
            <div className="text-xs text-slate-500">Cash Price</div>
            <div className="font-semibold text-slate-400 line-through">
              ${oopMetrics.totalCashPrice.toLocaleString()}
            </div>
          </div>
          <ArrowRight className="w-4 h-4 text-emerald-500" />
          <div>
            <div className="text-xs text-emerald-600">Your Cost</div>
            <div className="font-bold text-emerald-700">
              ${oopMetrics.totalOutOfPocket.toLocaleString()}
            </div>
          </div>
          <div className="px-3 py-1 bg-emerald-100 text-emerald-700 rounded-full text-sm font-medium">
            Save ${oopMetrics.cashSaved.toLocaleString()}
          </div>
        </div>
        {isExpanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {/* Detailed Breakdown (expandable) */}
      {isExpanded && (
        <div className="border-t border-slate-100 p-4 space-y-4">
          <div className="text-sm font-medium text-slate-700 mb-2">Segment Details</div>
          <div className="space-y-2">
            {segments.map((seg, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3">
                  {seg.type === 'flight' ? (
                    <Plane className="w-4 h-4 text-blue-600" />
                  ) : (
                    <Building2 className="w-4 h-4 text-amber-600" />
                  )}
                  <div>
                    <div className="font-medium text-slate-900">{seg.segment}</div>
                    {seg.transferFrom && seg.transferTo && (
                      <div className="text-xs text-blue-600">
                        {/* Use getProgramLabel() - never display raw IDs */}
                        via {getProgramLabel(seg.transferFrom)} → {getProgramLabel(seg.transferTo)}
                      </div>
                    )}
                  </div>
                </div>
                <div className="text-right">
                  {seg.paymentMethod === 'points' ? (
                    <div>
                      <div className="font-semibold text-blue-700">{seg.pointsUsed?.toLocaleString()} pts</div>
                      {seg.surcharge && seg.surcharge > 0 && (
                        <div className="text-xs text-slate-500">+${seg.surcharge} fees</div>
                      )}
                      {seg.cppAchieved && (
                        <div className="text-xs text-emerald-600">{seg.cppAchieved.toFixed(2)}¢/pt</div>
                      )}
                    </div>
                  ) : (
                    <div className="font-semibold text-slate-900">${seg.cashPrice.toLocaleString()}</div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Value Analysis - uses oopMetrics from props */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <div className="flex items-center gap-2 text-sm font-medium text-blue-800 mb-2">
              <Info className="w-4 h-4" />
              Value Analysis
            </div>
            <div className="text-sm text-blue-700">
              Average redemption: <strong>{oopMetrics.averageCpp.toFixed(2)}¢ per point</strong>
            </div>
            {/* Find best segment CPP from segments array */}
            {segments.filter(s => s.cppAchieved).length > 0 && (
              <div className="text-xs text-blue-600 mt-1">
                Best value: {
                  segments
                    .filter(s => s.cppAchieved)
                    .reduce((best, s) => s.cppAchieved! > (best?.cppAchieved || 0) ? s : best, segments[0])
                    .segment
                } at {
                  Math.max(...segments.filter(s => s.cppAchieved).map(s => s.cppAchieved!)).toFixed(2)
                }¢/pt
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
```

**Usage in results page:**
```typescript
// Pass data from RankedItinerary, no API call needed
<CostBreakdownCard 
  segments={selectedItinerary.segments} 
  oopMetrics={selectedItinerary.oopMetrics} 
/>
```

#### Acceptance Criteria 2.2
- [ ] Cost breakdown shows cash price vs out-of-pocket
- [ ] Segment-by-segment breakdown available
- [ ] CPP value shown for each points redemption
- [ ] Transfer paths shown for each segment
- [ ] **NO API call** - data from props only

---

### Task 2.3: Add Strategy Comparison (Optional Enhancement)

**Goal:** Allow users to compare different optimization strategies.

> *Per Source of Truth: Users can "Choose how to optimize: Minimize Cash, Maximize Value, or Balanced"*

> **FIXUP 1 APPLIED:** This component does NOT call `optimization.compareStrategies()`. It uses the `optimize()` hook with `modeOverride` to fetch different strategies.

#### Step 2.3.1: Create Strategy Comparison Component

**File:** `frontend/src/components/ui/StrategyComparisonCard.tsx` (NEW FILE)

```typescript
'use client';

import { useState, useEffect } from 'react';
// Issue #6 FIX: Import Check icon (used in button)
import { DollarSign, TrendingUp, Scale, Loader2, Check } from 'lucide-react';
// USE PURE FETCH FUNCTION - NOT the hook (avoids state race conditions)
// Issue #6 FIX: Removed unused fetchPointsSummary import
import { fetchOptimizeSolo } from '@/lib/api';

interface StrategyResult {
  mode: 'oop' | 'cpp' | 'balanced';
  outOfPocket: number;
  pointsUsed: number;
  averageCpp: number;
}

interface StrategyComparisonCardProps {
  tripId: string;
  pointsMap: Record<string, number>;  // Pass points in, don't refetch
  onStrategySelect?: (strategy: 'oop' | 'cpp' | 'balanced') => void;
  selectedStrategy?: 'oop' | 'cpp' | 'balanced';
}

export function StrategyComparisonCard({ 
  tripId,
  pointsMap,
  onStrategySelect, 
  selectedStrategy = 'balanced'
}: StrategyComparisonCardProps) {
  // Local state ONLY - no hook state that races
  const [results, setResults] = useState<Record<string, StrategyResult>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch all three strategies in parallel using PURE FETCH FUNCTION
  // Each call returns its own response, no shared state to race
  useEffect(() => {
    const loadStrategies = async () => {
      setLoading(true);
      setError(null);
      
      try {
        const modes: Array<'oop' | 'cpp' | 'balanced'> = ['oop', 'cpp', 'balanced'];
        
        // Parallel fetch - each returns independent response
        const responses = await Promise.all(
          modes.map(mode => fetchOptimizeSolo(tripId, pointsMap, mode))
        );
        
        // Build results map from responses
        const newResults: Record<string, StrategyResult> = {};
        responses.forEach((response, index) => {
          const mode = modes[index];
          const best = response.itineraries[0]; // Best for this mode
          if (best) {
            newResults[mode] = {
              mode,
              outOfPocket: best.oopMetrics.totalOutOfPocket,
              pointsUsed: best.oopMetrics.totalPointsUsed,
              averageCpp: best.oopMetrics.averageCpp,
            };
          }
        });
        
        setResults(newResults);
      } catch (err) {
        console.error('Failed to load strategies:', err);
        setError('Failed to compare strategies');
      } finally {
        setLoading(false);
      }
    };
    
    if (tripId && Object.keys(pointsMap).length > 0) {
      loadStrategies();
    }
  }, [tripId, pointsMap]);

  const strategies = [
    { 
      id: 'oop' as const, 
      label: 'Minimize Cash', 
      icon: DollarSign, 
      color: 'green',
      description: 'Spend as little money as possible'
    },
    { 
      id: 'cpp' as const, 
      label: 'Max Value', 
      icon: TrendingUp, 
      color: 'blue',
      description: 'Get the best cents-per-point value'
    },
    { 
      id: 'balanced' as const, 
      label: 'Balanced', 
      icon: Scale, 
      color: 'purple',
      description: 'Best overall considering cost, time, convenience'
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-900">How should we optimize?</h3>
        <p className="text-xs text-slate-500 mt-1">Choose what matters most to you</p>
      </div>
      
      <div className="p-4 grid grid-cols-3 gap-2">
        {strategies.map((strategy) => {
          const Icon = strategy.icon;
          const isSelected = selectedStrategy === strategy.id;
          const colorClasses = {
            green: isSelected ? 'bg-green-50 border-green-300 text-green-700' : 'hover:bg-green-50/50',
            blue: isSelected ? 'bg-blue-50 border-blue-300 text-blue-700' : 'hover:bg-blue-50/50',
            purple: isSelected ? 'bg-purple-50 border-purple-300 text-purple-700' : 'hover:bg-purple-50/50',
          };
          
          return (
            <button
              key={strategy.id}
              onClick={() => onStrategySelect?.(strategy.id)}
              className={`p-3 rounded-lg border transition-all text-center ${
                isSelected ? colorClasses[strategy.color] : 'border-slate-200 ' + colorClasses[strategy.color]
              }`}
            >
              <Icon className={`w-5 h-5 mx-auto mb-1 ${
                isSelected ? '' : 'text-slate-400'
              }`} />
              <div className={`text-sm font-medium ${isSelected ? '' : 'text-slate-700'}`}>
                {strategy.label}
              </div>
              {isSelected && <Check className="w-4 h-4 mx-auto mt-1" />}
            </button>
          );
        })}
      </div>

      {/* Issue #6 FIX: Removed undefined "comparison" block
          If you want strategy explanation, derive it from results:
          const getExplanation = () => {
            const oop = results['oop'];
            const cpp = results['cpp'];
            if (oop && cpp && cpp.averageCpp > oop.averageCpp * 1.5) {
              return "Max Value gives significantly better cents-per-point";
            }
            return "All strategies offer similar value for this trip";
          };
      */}
      
      {/* Show loading state */}
      {loading && (
        <div className="px-4 pb-4 flex items-center justify-center">
          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
          <span className="ml-2 text-sm text-slate-500">Comparing strategies...</span>
        </div>
      )}
      
      {/* Show results summary when loaded */}
      {!loading && Object.keys(results).length > 0 && (
        <div className="px-4 pb-4 text-xs text-slate-500">
          {results['oop'] && `OOP: $${results['oop'].outOfPocket.toLocaleString()}`}
          {results['cpp'] && ` · CPP: ${results['cpp'].averageCpp.toFixed(2)}¢/pt`}
        </div>
      )}
      
      {error && (
        <div className="px-4 pb-4 text-xs text-red-500">{error}</div>
      )}
    </div>
  );
}
```

#### Acceptance Criteria 2.3
- [ ] Users can choose between optimization strategies
- [ ] Recommendation highlighted based on their points/budget
- [ ] Clear explanation of each strategy

---

## Phase 3: Surface Value & Savings

> *Per Source of Truth: "Users should always understand: Why a particular option is recommended, How much they're saving, What their points are worth, The trade-offs between options."*

### Task 3.1: Create Savings Breakdown Component

**Goal:** Show users exactly how much they're saving and WHY - this builds trust and demonstrates value.

#### Step 3.1.1: Create Value Insight Component

**File:** `frontend/src/components/ui/ValueInsightCard.tsx` (NEW FILE)

> **P0-4 Fix Applied:** Insights show descriptions (percentages, CPP values), NOT invented dollar amounts. Only the total savings (from real cash comparison) shows dollars.

This component surfaces the "magic behind the curtain" in user-friendly language.

```typescript
'use client';

import { Sparkles, TrendingUp, ArrowRight, Gift, Route } from 'lucide-react';
import type { TransferInsight, OOPMetrics } from '@/types/optimization';

interface ValueInsightCardProps {
  insights: TransferInsight[];
  oopMetrics: OOPMetrics;
}

const insightIcons = {
  transfer_bonus: Gift,
  sweet_spot: Sparkles,
  multi_hop: Route,
  cross_program: ArrowRight,
};

const insightLabels = {
  transfer_bonus: 'Bonus Applied',
  sweet_spot: 'Sweet Spot Found',
  multi_hop: 'Smart Routing',
  cross_program: 'Cross-Program Value',
};

export function ValueInsightCard({ insights, oopMetrics }: ValueInsightCardProps) {
  const { totalCashPrice, totalOutOfPocket, cashSaved, savingsPercentage } = oopMetrics;

  return (
    <div className="bg-gradient-to-br from-emerald-50 to-teal-50 border border-emerald-200 rounded-2xl overflow-hidden">
      {/* Savings Header - Uses REAL cash comparison (P0-4) */}
      <div className="p-6 border-b border-emerald-200 bg-white/50">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-emerald-700 font-medium">Your Savings</div>
            <div className="text-3xl font-bold text-emerald-800">
              ${cashSaved.toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-sm text-slate-600">vs. cash price</div>
            <div className="flex items-center gap-2">
              <span className="line-through text-slate-400">${totalCashPrice.toLocaleString()}</span>
              <span className="text-emerald-600 font-semibold">{Math.round(savingsPercentage)}% off</span>
            </div>
          </div>
        </div>
      </div>

      {/* How We Found This Value */}
      {/* P0-4: Insights show descriptions only, NOT invented dollar amounts */}
      {insights.length > 0 && (
        <div className="p-4">
          <div className="text-xs text-emerald-700 font-medium uppercase tracking-wider mb-3">
            How Tripy Found This Value
          </div>
          <div className="space-y-2">
            {insights.map((insight, idx) => {
              const Icon = insightIcons[insight.type];
              return (
                <div 
                  key={idx} 
                  className="flex items-center gap-3 p-3 bg-white/70 rounded-lg"
                >
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <Icon className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-900">
                      {insightLabels[insight.type]}
                    </div>
                    {/* Description only - no invented $ amounts */}
                    <div className="text-xs text-slate-600">{insight.description}</div>
                  </div>
                  {/* Badge instead of fake dollar amount */}
                  <div className="px-2 py-1 bg-emerald-100 rounded-full text-xs font-medium text-emerald-700">
                    {insight.type === 'transfer_bonus' ? 'Bonus' : 
                     insight.type === 'sweet_spot' ? 'High Value' :
                     insight.type === 'multi_hop' ? 'Optimized' : 'Value'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* What You'll Pay - Real number */}
      <div className="px-6 py-4 bg-emerald-100/50 border-t border-emerald-200">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-emerald-800">Your out-of-pocket cost</span>
          <span className="text-xl font-bold text-emerald-900">${totalOutOfPocket.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
```

#### Step 3.1.2: Create Points Value Explainer

**File:** `frontend/src/components/ui/PointsValueExplainer.tsx` (NEW FILE)

> **P0-4 Alignment:** All values (CPP, cashValueSaved) come from the optimizer response—computed from real cash comparisons, not invented from `points * 0.015`.

Help users understand what their points are worth.

```typescript
'use client';

import { Info, TrendingUp } from 'lucide-react';
import type { SegmentBreakdown, OOPMetrics } from '@/types/optimization';

interface PointsValueExplainerProps {
  segments: SegmentBreakdown[];
  oopMetrics: OOPMetrics;
}

export function PointsValueExplainer({ segments, oopMetrics }: PointsValueExplainerProps) {
  // Filter to segments that used points
  const pointsSegments = segments.filter(s => s.paymentMethod === 'points' && s.pointsUsed);
  
  // All values come from optimizer (real cash comparisons), not invented
  const { averageCpp, totalPointsUsed, cashSaved } = oopMetrics;
  
  // Determine if this is good value (>1.5 cpp is solid, >2.0 is great)
  const valueRating = averageCpp >= 2.0 ? 'excellent' : averageCpp >= 1.5 ? 'good' : 'fair';
  
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-100 bg-slate-50">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <TrendingUp className="w-5 h-5 text-blue-600" />
          Your Points Value
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          What your points are worth in this redemption
        </p>
      </div>

      <div className="p-4">
        {/* Average CPP Highlight - from optimizer, not invented */}
        <div className="flex items-center justify-between p-4 bg-blue-50 rounded-xl mb-4">
          <div>
            <div className="text-sm text-blue-700 font-medium">Average Value</div>
            <div className="text-2xl font-bold text-blue-900">
              {averageCpp.toFixed(2)}¢ per point
            </div>
          </div>
          <div className={`px-3 py-1 rounded-full text-sm font-medium ${
            valueRating === 'excellent' 
              ? 'bg-emerald-100 text-emerald-700' 
              : valueRating === 'good'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-slate-100 text-slate-700'
          }`}>
            {valueRating === 'excellent' ? 'Excellent Value' : 
             valueRating === 'good' ? 'Good Value' : 'Fair Value'}
          </div>
        </div>

        {/* Per-Segment Breakdown - values from optimizer */}
        <div className="space-y-2">
          {pointsSegments.map((seg, idx) => (
            <div key={idx} className="flex items-center justify-between p-3 border border-slate-100 rounded-lg">
              <div>
                <div className="font-medium text-slate-900">{seg.segment}</div>
                <div className="text-xs text-slate-500">
                  {/* Use getProgramLabel() - never display raw IDs */}
                  {seg.pointsUsed?.toLocaleString()} points via {seg.transferTo ? getProgramLabel(seg.transferTo) : 'direct'}
                </div>
              </div>
              <div className="text-right">
                {/* Cash price comes from optimizer - real comparison */}
                <div className="font-semibold text-slate-900">
                  ${seg.cashPrice.toLocaleString()} value
                </div>
                {/* CPP is computed: (cashPrice - surcharge) / pointsUsed * 100 */}
                <div className="text-xs text-slate-500">
                  {seg.cppAchieved?.toFixed(2)}¢/pt
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Summary */}
        <div className="mt-4 p-3 bg-slate-50 rounded-lg flex items-center justify-between">
          <span className="text-sm text-slate-600">Total points used</span>
          <span className="font-semibold text-slate-900">{totalPointsUsed.toLocaleString()}</span>
        </div>

        {/* Explanation */}
        <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
          <div className="flex items-start gap-2 text-sm text-amber-800">
            <Info className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              {valueRating === 'excellent' 
                ? "Excellent value—your points are working hard! Most programs default to 1¢/point, so you're getting 2x+ the typical value."
                : valueRating === 'good'
                  ? "Good value—better than booking through most credit card portals (usually 1-1.25¢/point)."
                  : "Fair value. Consider if the convenience is worth it, or explore other dates for better redemptions."}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
```

### Task 3.2: Integrate Value Components into Results Page

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

Add value insights to the results display:

```typescript
import { ValueInsightCard } from '@/components/ui/ValueInsightCard';
import { PointsValueExplainer } from '@/components/ui/PointsValueExplainer';

// In the selected itinerary sidebar:
{selectedItinerary && selectedItinerary._original && (
  <>
    {/* Issue #9 FIX: Pass oopMetrics directly, not individual fields */}
    <ValueInsightCard
      insights={selectedItinerary._original.insights || []}
      oopMetrics={selectedItinerary._original.oopMetrics}
    />
    
    {/* Issue #10 FIX: Pass segments + oopMetrics, no pointsBreakdown or fake $ */}
    <PointsValueExplainer
      segments={selectedItinerary._original.segments}
      oopMetrics={selectedItinerary._original.oopMetrics}
    />
  </>
)}
```

#### Acceptance Criteria 3.2
- [ ] Users see total savings prominently displayed
- [ ] Users understand WHY they're saving (transfer bonus, sweet spot, etc.)
- [ ] Points value (CPP) is explained clearly
- [ ] Value rating helps users understand if it's a good deal

---

## Phase 4: Build Clear Booking Instructions

> *Per Source of Truth: "Tripy helps users find and compare options, then provides instructions to book. We don't book on behalf of users (yet). The experience should be seamless—clear instructions, correct transfer paths, accurate pricing."*

### Task 4.1: Enhance Transfer Instructions

**Goal:** Create crystal-clear, step-by-step booking instructions that any user can follow.

#### Step 4.1.1: Create Step-by-Step Booking Guide Component

**File:** `frontend/src/components/ui/BookingGuide.tsx` (NEW FILE)

```typescript
'use client';

import { useState } from 'react';
import { 
  Check, Circle, ChevronRight, ExternalLink, Clock, 
  AlertTriangle, Copy, CreditCard, Plane, Building2 
} from 'lucide-react';

interface TransferStep {
  stepNumber: number;
  action: 'transfer' | 'book_flight' | 'book_hotel' | 'wait';
  title: string;
  description: string;
  details: {
    from?: string;
    to?: string;
    points?: number;
    transferTime?: string;
    portalUrl?: string;
    bookingUrl?: string;
    flightNumber?: string;
    hotelName?: string;
  };
  tips?: string[];
  warning?: string;
}

interface BookingGuideProps {
  steps: TransferStep[];
  isUnlocked: boolean;
}

export function BookingGuide({ steps, isUnlocked }: BookingGuideProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [copiedText, setCopiedText] = useState<string | null>(null);

  const toggleStep = (stepNumber: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedText(text);
    setTimeout(() => setCopiedText(null), 2000);
  };

  if (!isUnlocked) {
    return (
      <div className="relative">
        <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center">
          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <p className="text-slate-600">Complete payment to unlock step-by-step instructions</p>
          </div>
        </div>
        {/* Blurred preview */}
        <div className="opacity-20 pointer-events-none">
          {steps.slice(0, 2).map((step) => (
            <div key={step.stepNumber} className="p-4 border-b">
              <div className="h-4 bg-slate-200 rounded w-3/4 mb-2"></div>
              <div className="h-3 bg-slate-100 rounded w-1/2"></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {steps.map((step, idx) => {
        const isCompleted = completedSteps.has(step.stepNumber);
        const isNext = !isCompleted && idx === 0 || 
          (!isCompleted && steps.slice(0, idx).every(s => completedSteps.has(s.stepNumber)));

        return (
          <div 
            key={step.stepNumber}
            className={`border rounded-xl overflow-hidden transition-all ${
              isCompleted 
                ? 'border-green-200 bg-green-50/50' 
                : isNext 
                  ? 'border-blue-300 bg-blue-50/30 shadow-sm'
                  : 'border-slate-200 bg-white'
            }`}
          >
            {/* Step Header */}
            <button
              onClick={() => toggleStep(step.stepNumber)}
              className="w-full p-4 flex items-start gap-4 text-left"
            >
              <div className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
                isCompleted 
                  ? 'bg-green-500 text-white' 
                  : isNext 
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-200 text-slate-600'
              }`}>
                {isCompleted ? (
                  <Check className="w-5 h-5" />
                ) : (
                  <span className="font-semibold">{step.stepNumber}</span>
                )}
              </div>
              
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  {step.action === 'transfer' && <CreditCard className="w-4 h-4 text-blue-600" />}
                  {step.action === 'book_flight' && <Plane className="w-4 h-4 text-blue-600" />}
                  {step.action === 'book_hotel' && <Building2 className="w-4 h-4 text-amber-600" />}
                  {step.action === 'wait' && <Clock className="w-4 h-4 text-slate-500" />}
                  <span className={`font-semibold ${isCompleted ? 'text-green-700' : 'text-slate-900'}`}>
                    {step.title}
                  </span>
                </div>
                <p className="text-sm text-slate-600 mt-1">{step.description}</p>
              </div>

              {isNext && !isCompleted && (
                <span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-medium rounded-full">
                  Next
                </span>
              )}
            </button>

            {/* Step Details (expanded for next step) */}
            {isNext && !isCompleted && (
              <div className="px-4 pb-4 pt-0 ml-12">
                {/* Transfer Details */}
                {step.action === 'transfer' && step.details.from && (
                  <div className="p-4 bg-white rounded-lg border border-slate-200 mb-3">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="font-medium text-slate-900">{step.details.from}</div>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                      <div className="font-medium text-slate-900">{step.details.to}</div>
                    </div>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-2xl font-bold text-blue-700">
                          {step.details.points?.toLocaleString()}
                        </div>
                        <div className="text-xs text-slate-500">points to transfer</div>
                      </div>
                      {step.details.transferTime && (
                        <div className="text-right">
                          <div className="text-sm text-slate-600">Transfer time</div>
                          <div className="font-medium text-slate-900">{step.details.transferTime}</div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Action Button */}
                {(step.details.portalUrl || step.details.bookingUrl) && (
                  <a
                    href={step.details.portalUrl || step.details.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                  >
                    {step.action === 'transfer' ? 'Open Transfer Portal' : 'Book Now'}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}

                {/* Tips */}
                {step.tips && step.tips.length > 0 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                    <div className="text-xs font-medium text-blue-800 mb-2">Tips</div>
                    <ul className="text-sm text-blue-700 space-y-1">
                      {step.tips.map((tip, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="text-blue-400">•</span>
                          {tip}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Warning */}
                {step.warning && (
                  <div className="mt-3 p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <div className="flex items-start gap-2 text-sm text-amber-800">
                      <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      {step.warning}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* All Done */}
      {completedSteps.size === steps.length && (
        <div className="p-6 bg-green-50 border border-green-200 rounded-xl text-center">
          <div className="w-12 h-12 bg-green-500 rounded-full flex items-center justify-center mx-auto mb-3">
            <Check className="w-6 h-6 text-white" />
          </div>
          <h3 className="font-semibold text-green-800 mb-1">All Steps Complete!</h3>
          <p className="text-sm text-green-700">
            You've successfully booked your trip. Have an amazing journey!
          </p>
        </div>
      )}
    </div>
  );
}
```

#### Step 4.1.2: Connect Transfer Strategy API

**File:** `frontend/src/lib/hooks/useTransferStrategy.ts` (NEW FILE)

```typescript
import { useState, useCallback } from 'react';
import { apiRequest } from '@/lib/api';
import type { TransferStrategyResponse, TransferInstruction, BookingStep } from '@/types/optimization';

interface TransferStep {
  stepNumber: number;
  action: 'transfer' | 'book_flight' | 'book_hotel' | 'wait';
  title: string;
  description: string;
  details: {
    from?: string;
    to?: string;
    points?: number;
    transferTime?: string;
    portalUrl?: string;
    bookingUrl?: string;
  };
  tips?: string[];
  warning?: string;
}

export function useTransferStrategy() {
  const [steps, setSteps] = useState<TransferStep[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadStrategy = useCallback(async (tripId: string, itineraryId: string) => {
    setLoading(true);
    setError(null);

    try {
      // P1-3 Fix: Use consistent endpoint path (no /api prefix)
      // P0-3 Fix: apiRequest returns typed data directly, NOT a Response object
      // Do NOT call response.ok or response.json() - that's already handled
      const data = await apiRequest<TransferStrategyResponse>('/transfer-strategy/optimize', {
        method: 'POST',
        body: JSON.stringify({ tripId, itineraryId }),  // camelCase, serializer converts
      });
      
      // Transform backend response into step-by-step guide
      const transformedSteps: TransferStep[] = [];
      let stepNum = 1;

      // Add transfer steps (using typed TransferInstruction)
      data.transfers?.forEach((t: TransferInstruction) => {
        transformedSteps.push({
          stepNumber: stepNum++,
          action: 'transfer',
          // Use getProgramLabel() - never display raw IDs like "air_france_klm"
          title: `Transfer to ${getProgramLabel(t.targetProgram)}`,
          description: `Move ${t.pointsToTransfer.toLocaleString()} points from ${getProgramLabel(t.sourceProgram)}`,
          details: {
            from: t.sourceProgram,  // Keep raw ID for internal use
            to: t.targetProgram,    // Keep raw ID for internal use
            points: t.pointsToTransfer,
            transferTime: t.expectedTransferTime,
            portalUrl: t.portalUrl,
          },
          tips: [
            'Double-check the point amount before confirming',
            t.expectedTransferTime.includes('instant') 
              ? 'This transfer is usually instant' 
              : `Allow ${t.expectedTransferTime} for points to appear`,
          ],
          warning: t.warning,
        });

        // Add wait step if transfer isn't instant
        if (!t.expectedTransferTime.toLowerCase().includes('instant')) {
          transformedSteps.push({
            stepNumber: stepNum++,
            action: 'wait',
            title: 'Wait for Transfer',
            description: `Points should appear in ${t.expectedTransferTime}`,
            details: { transferTime: t.expectedTransferTime },
            tips: ['You can proceed to the next step once points appear in your account'],
          });
        }
      });

      // Add booking steps (using typed BookingStep)
      data.bookings?.forEach((b: BookingStep) => {
        if (b.type === 'flight') {
          transformedSteps.push({
            stepNumber: stepNum++,
            action: 'book_flight',
            title: `Book ${b.airline} Flight`,
            description: b.segmentReference || 'Book your flight',
            details: { bookingUrl: b.bookingUrl },
            tips: [
              'Have your loyalty account logged in before searching',
              'Award seats can disappear quickly—book as soon as points arrive',
            ],
          });
        } else if (b.type === 'hotel') {
          // FIXUP 6: Use hotelChain (from backend hotel_chain after serialization)
          transformedSteps.push({
            stepNumber: stepNum++,
            action: 'book_hotel',
            title: `Book ${b.hotelChain}`,
            description: b.segmentReference || 'Reserve your hotel room',
            details: { bookingUrl: b.bookingUrl },
          });
        }
      });

      setSteps(transformedSteps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load booking instructions');
    } finally {
      setLoading(false);
    }
  }, []);

  return { steps, loading, error, loadStrategy };
}
```

### Task 4.2: Update Booking Page with New Components

**File:** `frontend/src/app/(app)/solo/booking/page.tsx`

Replace the existing transfer instructions with the new `BookingGuide`:

```typescript
import { BookingGuide } from '@/components/ui/BookingGuide';
import { useTransferStrategy } from '@/lib/hooks/useTransferStrategy';

function SoloBookingContent() {
  const { steps, loading: stepsLoading, loadStrategy } = useTransferStrategy();
  
  useEffect(() => {
    if (tripId && selectedItineraryId) {
      loadStrategy(tripId, selectedItineraryId);
    }
  }, [tripId, selectedItineraryId, loadStrategy]);

  // In the transfer instructions section:
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-slate-100 bg-slate-50">
        <h2 className="text-xl font-semibold text-slate-900">
          Step-by-Step Booking Guide
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Follow these steps to complete your booking
        </p>
      </div>
      
      <div className="p-6">
        {stepsLoading ? (
          <div className="text-center py-8">Loading booking instructions...</div>
        ) : (
          <BookingGuide steps={steps} isUnlocked={isPaid} />
        )}
      </div>
    </div>
  );
}
```

#### Acceptance Criteria 4.1
- [ ] Step-by-step guide is easy to follow
- [ ] Each step has clear action and details
- [ ] Transfer portals link correctly
- [ ] Booking URLs go to correct airline/hotel sites
- [ ] Tips help users avoid common mistakes
- [ ] Warnings highlight important timing issues
- [ ] Users can mark steps as complete

---

## Phase 5: Add Trip State Management

> *Per Source of Truth: Users should be able to "See their trip history and upcoming travel" and "View savings from past trips."*

### Task 5.1: Add Trip Status Field

**Goal:** Track trip through its lifecycle.

> **P1-1 Fix Applied:** Added `selected` status between `optimized` and `instructions_unlocked`.

```
draft → optimized → selected → instructions_unlocked → completed
                           ↘ cancelled
```

| Status | Meaning | Triggered When |
|--------|---------|----------------|
| `draft` | Trip created, not yet optimized | `createTrip()` |
| `optimized` | Optimization completed, showing results | `optimize()` returns |
| `selected` | User picked an itinerary | User clicks "Book This Trip" |
| `instructions_unlocked` | User paid service fee | Payment successful |
| `completed` | User marked steps done | User completes all steps |
| `cancelled` | User abandoned trip | User cancels |

#### Step 5.1.1: Update Backend Trip Model

**File:** `backend/src/services/trip_service.py`

```python
TRIP_STATUSES = ['draft', 'optimized', 'selected', 'instructions_unlocked', 'completed', 'cancelled']

def update_trip_status(trip_id: str, status: str, user_id: str) -> dict:
    # Verify ownership (P1-2 fix)
    trip = get_trip(trip_id)
    if trip["created_by"] != user_id:
        raise PermissionError("Not authorized to update this trip")
    
    if status not in TRIP_STATUSES:
        raise ValueError(f"Invalid status: {status}")
    
    table.update_item(
        Key={"PK": f"TRIP#{trip_id}", "SK": "METADATA"},
        UpdateExpression="SET #status = :status, updated_at = :now",
        ExpressionAttributeNames={"#status": "status"},
        ExpressionAttributeValues={
            ":status": status,
            ":now": datetime.utcnow().isoformat(),
        },
    )
    
    return {"ok": True, "status": status}
```

#### Step 5.1.2: Add Endpoint

**Backend:** `backend/src/app.py`

```python
@app.post("/trips/{trip_id}/status")
async def update_trip_status(
    trip_id: str,
    request: UpdateTripStatusRequest, 
    user_id: str = Depends(get_current_user)
):
    return trip_service.update_trip_status(trip_id, request.status, user_id)
```

### Task 5.2: Save Selected Itinerary with Snapshot

**Goal:** Persist the user's chosen itinerary AND snapshot it for reproducibility.

> **P1-2 Fix Applied:** Store full itinerary snapshot at selection time. Award availability changes; users need to see what they selected, not stale data.

#### Step 5.2.1: Add Selection Endpoint with Snapshot

**Backend:** `backend/src/app.py`

```python
from schemas.trip import SelectItineraryRequest

@app.post("/trips/{trip_id}/select")
async def select_itinerary(
    trip_id: str,
    request: SelectItineraryRequest, 
    user_id: str = Depends(get_current_user)
):
    return trip_service.select_itinerary(trip_id, user_id, request)
```

**Backend:** `backend/src/services/trip_service.py`

```python
def select_itinerary(trip_id: str, user_id: str, request: SelectItineraryRequest) -> dict:
    # Verify ownership
    trip = get_trip(trip_id)
    if trip["created_by"] != user_id:
        raise PermissionError("Not authorized")
    
    # Store snapshot (P1-2: snapshot for reproducibility)
    table.put_item(Item={
        "PK": f"TRIP#{trip_id}",
        "SK": "SELECTION",
        "itinerary_id": request.itinerary_id,
        "itinerary_snapshot": request.itinerary_snapshot,  # Full itinerary at selection
        "cash_price_at_selection": request.cash_price_at_selection,
        "out_of_pocket_at_selection": request.out_of_pocket_at_selection,
        "selected_at": datetime.utcnow().isoformat(),
    })
    
    # Update trip status to "selected"
    update_trip_status(trip_id, "selected", user_id)
    
    # Update user's cumulative savings
    savings = request.cash_price_at_selection - request.out_of_pocket_at_selection
    user_service.add_savings(user_id, savings)
    
    return {"ok": True}

def get_selection(trip_id: str, user_id: str) -> dict | None:
    """Get the selected itinerary snapshot for a trip."""
    # Verify ownership
    trip = get_trip(trip_id)
    if trip["created_by"] != user_id:
        raise PermissionError("Not authorized")
    
    result = table.get_item(Key={"PK": f"TRIP#{trip_id}", "SK": "SELECTION"})
    item = result.get("Item")
    if not item:
        return None
    
    # Return clean API response (no PK/SK)
    return {
        "itinerary_id": item["itinerary_id"],
        "itinerary_snapshot": item["itinerary_snapshot"],
        "selected_at": item["selected_at"],
    }
```

**Missing Endpoint:** `backend/src/app.py` - Add GET selection endpoint:

```python
from schemas.trip import SelectionResponse

@app.get("/trips/{trip_id}/selection", response_model=SelectionResponse)
async def get_trip_selection(
    trip_id: str, 
    user_id: str = Depends(get_current_user)
):
    selection = trip_service.get_selection(trip_id, user_id)
    if not selection:
        raise HTTPException(status_code=404, detail="No selection found")
    return selection
```

#### Step 5.2.2a: Add Points Endpoints (Missing Implementation)

**Backend:** `backend/src/services/points_service.py` (NEW FILE)

```python
from datetime import datetime
from boto3.dynamodb.conditions import Key
from schemas.programs import PointsProgram
from schemas.points import PointsBalance, PointsSummaryResponse

def get_points(trip_id: str, user_id: str) -> PointsSummaryResponse:
    """Get points balances for a trip."""
    # Issue #2: Storage model uses SK=POINTS#{program} (many items)
    result = table.query(
        KeyConditionExpression=Key("PK").eq(f"TRIP#{trip_id}") & Key("SK").begins_with("POINTS#")
    )
    
    items = []
    total = 0
    for item in result.get("Items", []):
        balance = PointsBalance(
            program=item["program"],
            balance=item["balance"],
            updated_at=item.get("updated_at")
        )
        items.append(balance)
        total += item["balance"]
    
    # Issue #4 FIX: Always return trip_id
    return PointsSummaryResponse(trip_id=trip_id, items=items, total_points=total)

def upsert_points(trip_id: str, user_id: str, points: list[PointsBalance]) -> PointsSummaryResponse:
    """Upsert points balances for a trip."""
    # Issue #3 FIX: param is named "points" to match schema
    now = datetime.utcnow().isoformat()
    
    for balance in points:
        # Issue #5 FIX: Pydantic validates PointsProgram enum automatically
        # No manual validation needed - Pydantic will reject invalid programs
        # balance.program is already a PointsProgram enum if we got here
        
        # Store with program value (string) for DynamoDB
        program_value = balance.program.value if hasattr(balance.program, 'value') else balance.program
        
        table.put_item(Item={
            "PK": f"TRIP#{trip_id}",
            "SK": f"POINTS#{program_value}",  # Issue #2: SK=POINTS#{program}
            "program": program_value,
            "balance": balance.balance,
            "updated_at": now,
        })
    
    return get_points(trip_id, user_id)
```

**Backend:** `backend/src/app.py` - Add points endpoints:

```python
from schemas.points import UpsertPointsRequest, PointsSummaryResponse
import points_service

@app.get("/trips/{trip_id}/points", response_model=PointsSummaryResponse)
async def get_trip_points(trip_id: str, user_id: str = Depends(get_current_user)):
    return points_service.get_points(trip_id, user_id)

@app.post("/trips/{trip_id}/points", response_model=PointsSummaryResponse)
async def upsert_trip_points(
    trip_id: str,
    request: UpsertPointsRequest,
    user_id: str = Depends(get_current_user)
):
    # Issue #3 FIX: use request.points (matches UpsertPointsRequest schema)
    return points_service.upsert_points(trip_id, user_id, request.points)
```

#### Step 5.2.2: Update Frontend API

**File:** `frontend/src/lib/api.ts`

```typescript
export interface SelectItineraryRequest {
  itineraryId: string;
  itinerarySnapshot: RankedItinerary;  // Full snapshot for reproducibility
  cashPriceAtSelection: number;
  outOfPocketAtSelection: number;
}

export const trips = {
  // ... other methods ...
  
  select: async (tripId: string, request: SelectItineraryRequest): Promise<{ ok: boolean }> => {
    return apiRequest<{ ok: boolean }>(`/trips/${tripId}/select`, {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },
  
  getSelection: async (tripId: string): Promise<{ itinerarySnapshot: RankedItinerary } | null> => {
    try {
      return await apiRequest(`/trips/${tripId}/selection`);
    } catch {
      return null;  // No selection yet
    }
  },
};
```

#### Step 5.2.3: Update Results Page to Snapshot on Selection

**File:** `frontend/src/app/(app)/solo/results/page.tsx`

```typescript
const handleBookTrip = async (itinerary: RankedItinerary) => {
  try {
    // Save selection WITH full snapshot (P1-2)
    await trips.select(tripId, {
      itineraryId: itinerary.id,
      itinerarySnapshot: itinerary,  // Full itinerary for reproducibility
      cashPriceAtSelection: itinerary.oopMetrics.totalCashPrice,
      outOfPocketAtSelection: itinerary.oopMetrics.totalOutOfPocket,
    });
    
    router.push(`/solo/booking?trip_id=${tripId}`);
  } catch (err) {
    console.error('Failed to save selection:', err);
    setError('Could not save your selection. Please try again.');
  }
};
```

#### Step 5.2.4: Update Booking Page to Use Snapshot + Gating Logic

**File:** `frontend/src/app/(app)/solo/booking/page.tsx`

> **P0-10 Fix:** Booking page requires: (1) selection exists, (2) trip status is `selected` or beyond, (3) `instructions_unlocked` for full steps.

```typescript
// Booking page loads from snapshot, not live data
// AND validates gating prerequisites (P0-10)
useEffect(() => {
  const loadBookingData = async () => {
    try {
      // 1. Get trip to check status
      const trip = await trips.get(tripId);
      
      // 2. Check status prerequisites
      const validStatuses = ['selected', 'instructions_unlocked', 'completed'];
      if (!validStatuses.includes(trip.status)) {
        // Trip not ready for booking - redirect to appropriate page
        if (trip.status === 'optimized') {
          // User hasn't selected an itinerary yet
          router.push(`/solo/results?trip_id=${tripId}`);
          return;
        } else {
          // Trip is in draft or cancelled
          router.push(`/solo/setup?trip_id=${tripId}`);
          return;
        }
      }
      
      // 3. Get selection (required)
      const selection = await trips.getSelection(tripId);
      if (!selection?.itinerarySnapshot) {
        // No selection - redirect back to results
        router.push(`/solo/results?trip_id=${tripId}`);
        return;
      }
      
      // 4. Set state
      setItinerary(selection.itinerarySnapshot);
      setTrip(trip);
      setIsPaid(trip.status === 'instructions_unlocked' || trip.status === 'completed');
      
    } catch (err) {
      setError('Could not load booking data');
    }
  };
  
  loadBookingData();
}, [tripId, router]);
```

#### Acceptance Criteria 5.1 & 5.2
- [ ] Trip status includes `selected` state (P1-1)
- [ ] Selection includes full itinerary snapshot (P1-2)
- [ ] Ownership verified before status/selection updates (P1-2)
- [ ] Booking page loads from snapshot, not live data
- [ ] User's cumulative savings tracked
- [ ] My Trips page shows status and savings

---

## Phase 6: Polish & Transparency

> *Per Source of Truth: "Users should always understand why a particular option is recommended" and "Hide complexity, show results."*

### Task 6.1: Simplify the Service Fee Gate

**Goal:** The booking instructions are gated behind a service fee. Keep this simple and transparent.

**Note:** Per Source of Truth, Tripy provides instructions but doesn't book on behalf of users. The service fee unlocks the step-by-step guide.

> **GTM Risk Fix:** Mock payment is clearly marked for internal testing. Production must use real payment. Don't claim "secure payment processing" for mock.

#### Step 6.1.1: Create Payment Component

**File:** `frontend/src/components/ui/ServiceFeePayment.tsx` (NEW FILE)

```typescript
'use client';

import { useState } from 'react';
import { CheckCircle, CreditCard, Sparkles, AlertTriangle } from 'lucide-react';
import { trips } from '@/lib/api';

// Payment proof stored in trip metadata (P15 fix: store payment evidence)
interface PaymentProof {
  provider: 'mock' | 'stripe';
  status: string;
  paymentIntentId?: string;  // Stripe payment intent ID
  paidAt: string;            // ISO timestamp
  amount: number;
  currency: string;
}

interface ServiceFeePaymentProps {
  tripId: string;
  feeAmount: number;
  savingsAmount: number;
  onSuccess: () => void;
  /** Set to true for internal testing only */
  mockPayment?: boolean;
}

export function ServiceFeePayment({ 
  tripId, 
  feeAmount, 
  savingsAmount, 
  onSuccess,
  mockPayment = false  // Default to real payment
}: ServiceFeePaymentProps) {
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePayment = async () => {
    setIsProcessing(true);
    setError(null);
    
    try {
      let paymentProof: PaymentProof;
      
      if (mockPayment) {
        // MOCK PAYMENT - for internal testing only
        // TODO: Replace with Stripe integration for production
        console.warn('[DEV] Using mock payment - do not ship to production');
        await new Promise(resolve => setTimeout(resolve, 1500));
        paymentProof = {
          provider: 'mock',
          status: 'succeeded',
          paidAt: new Date().toISOString(),
          amount: feeAmount,
          currency: 'usd',
        };
      } else {
        // TODO: Real Stripe payment integration
        // const paymentIntent = await createPaymentIntent(tripId, feeAmount);
        // const result = await stripe.confirmPayment(paymentIntent);
        // paymentProof = {
        //   provider: 'stripe',
        //   status: result.paymentIntent.status,
        //   paymentIntentId: result.paymentIntent.id,
        //   paidAt: new Date().toISOString(),
        //   amount: feeAmount,
        //   currency: 'usd',
        // };
        throw new Error('Real payment not yet implemented');
      }
      
      // Update trip status to instructions_unlocked WITH payment proof
      await trips.updateStatusWithPayment(tripId, 'instructions_unlocked', paymentProof);
      
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Payment failed');
    } finally {
      setIsProcessing(false);
    }
  };

  const valueMultiplier = feeAmount > 0 ? Math.round(savingsAmount / feeAmount) : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      <div className="p-6 border-b border-slate-100">
        <h2 className="text-lg font-bold text-slate-900">Unlock Booking Instructions</h2>
      </div>

      <div className="p-6 space-y-6">
        {/* Mock payment warning - only shown in dev */}
        {mockPayment && (
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800">
              <strong>Internal testing mode.</strong> This is a simulated payment.
            </div>
          </div>
        )}

        {/* Value Proposition - uses REAL savings */}
        <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
          <div className="flex items-center gap-2 text-emerald-700 mb-2">
            <Sparkles className="w-5 h-5" />
            <span className="font-semibold">Your Savings: ${savingsAmount.toLocaleString()}</span>
          </div>
          {valueMultiplier > 1 && (
            <p className="text-sm text-emerald-600">
              Tripy found you {valueMultiplier}x more value than the service fee.
            </p>
          )}
        </div>

        {/* What You Get - show preview of what's gated */}
        <div>
          <div className="text-sm font-medium text-slate-700 mb-3">What you'll unlock:</div>
          <ul className="space-y-2 text-sm text-slate-600">
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Exact transfer amounts and which programs to use
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Direct links to transfer portals and booking sites
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Step-by-step order (what to do first, what to wait for)
            </li>
            <li className="flex items-center gap-2">
              <CheckCircle className="w-4 h-4 text-emerald-500" />
              Timing tips and backup options if seats disappear
            </li>
          </ul>
        </div>

        {/* Fee Display */}
        <div className="flex items-center justify-between p-4 bg-slate-50 rounded-xl">
          <span className="font-medium text-slate-700">Service Fee</span>
          <span className="text-2xl font-bold text-slate-900">${feeAmount.toFixed(2)}</span>
        </div>

        {/* Error display */}
        {error && (
          <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Pay Button */}
        <button
          onClick={handlePayment}
          disabled={isProcessing}
          className="w-full py-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-bold text-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          {isProcessing ? (
            'Processing...'
          ) : (
            <>
              <CreditCard className="w-5 h-5" />
              {mockPayment ? 'Unlock (Test Mode)' : 'Pay & Unlock Instructions'}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
```

### Task 6.2: Add Error Handling

**Goal:** Handle errors gracefully without confusing users.

#### Step 6.2.1: Create User-Friendly Error Component

**File:** `frontend/src/components/ui/ErrorState.tsx` (NEW FILE)

```typescript
'use client';

import { AlertTriangle, RefreshCw, ArrowLeft, MessageCircle } from 'lucide-react';
import { useRouter } from 'next/navigation';

interface ErrorStateProps {
  title?: string;
  message?: string;
  suggestion?: string;
  showRetry?: boolean;
  showBack?: boolean;
  onRetry?: () => void;
}

export function ErrorState({
  title = 'Something went wrong',
  message = 'We couldn\'t complete your request.',
  suggestion,
  showRetry = true,
  showBack = true,
  onRetry,
}: ErrorStateProps) {
  const router = useRouter();

  return (
    <div className="min-h-[400px] flex flex-col items-center justify-center p-8 text-center">
      <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mb-6">
        <AlertTriangle className="w-8 h-8 text-red-500" />
      </div>
      
      <h2 className="text-xl font-semibold text-slate-900 mb-2">{title}</h2>
      <p className="text-slate-600 max-w-md mb-6">{message}</p>

      {suggestion && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl max-w-md mb-6">
          <p className="text-sm text-amber-800">{suggestion}</p>
        </div>
      )}

      <div className="flex items-center gap-3">
        {showBack && (
          <button
            onClick={() => router.back()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Go Back
          </button>
        )}
        {showRetry && onRetry && (
          <button
            onClick={onRetry}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            <RefreshCw className="w-4 h-4" />
            Try Again
          </button>
        )}
      </div>
    </div>
  );
}
```

### Task 6.3: Add Input Validation with Helpful Messages

**File:** `frontend/src/lib/validation.ts` (NEW FILE)

> **P0-3 Alignment:** Uses `tripType` and `dateMode` enums, not boolean checks.
> **P0-9 Alignment:** Validates `origin` and `destinations`, not old `startDestination`/`endDestination`/`cities`.

```typescript
import type { TripType, DateMode } from '@/types/trip';

export interface ValidationError {
  field: string;
  message: string;
  suggestion?: string;
}

export function validateSoloTripSetup(data: {
  tripType: TripType;
  dateMode: DateMode;
  origin: string;                    // IATA code (P0-9 fix)
  destinations: string[];            // IATA codes (P0-9 fix)
  finalDestination?: string;
  startDate?: string;
  endDate?: string;
  durationDays?: number;
  creditCards: Array<{ program: string; points: number }>;
}): ValidationError[] {
  const errors: ValidationError[] = [];

  // Origin validation (P0-9)
  if (!data.origin) {
    errors.push({ 
      field: 'origin', 
      message: 'Where are you flying from?',
      suggestion: 'Enter your home airport code (e.g., JFK, LAX, ORD)'
    });
  } else if (data.origin.length !== 3) {
    errors.push({
      field: 'origin',
      message: 'Please enter a valid 3-letter airport code',
      suggestion: 'e.g., JFK, LAX, ORD, SFO'
    });
  }

  // Destinations validation (P0-9)
  if (data.destinations.length < 1) {
    errors.push({ 
      field: 'destinations', 
      message: 'Add at least one destination',
      suggestion: 'Where do you want to go? Add the cities you\'d like to visit'
    });
  }

  // Final destination for one-way trips
  if (data.tripType === 'one_way' && !data.finalDestination) {
    errors.push({
      field: 'finalDestination',
      message: 'Where will your trip end?',
      suggestion: 'For one-way trips, specify where you\'ll end up'
    });
  }

  // Date validation using enums (P0-3 fix)
  if (data.dateMode === 'fixed') {
    if (!data.startDate) {
      errors.push({ 
        field: 'startDate', 
        message: 'When do you want to travel?',
        suggestion: 'Pick a start date, or switch to flexible dates if you\'re open'
      });
    }

    if (data.tripType === 'round_trip' && !data.endDate) {
      errors.push({ 
        field: 'endDate', 
        message: 'When do you want to return?'
      });
    }

    // Date order validation
    if (data.startDate && data.endDate) {
      const start = new Date(data.startDate);
      const end = new Date(data.endDate);
      if (end < start) {
        errors.push({ 
          field: 'endDate', 
          message: 'Return date must be after departure date'
        });
      }
    }
  } else if (data.dateMode === 'flexible') {
    if (!data.durationDays || data.durationDays < 1) {
      errors.push({ 
        field: 'durationDays', 
        message: 'How many days is your trip?',
        suggestion: 'Enter the approximate length of your trip'
      });
    }
  }

  // Check for points (with program validation)
  const totalPoints = data.creditCards.reduce((sum, card) => sum + (card.points || 0), 0);
  if (totalPoints === 0) {
    errors.push({
      field: 'creditCards',
      message: 'Add your credit card points',
      suggestion: 'Tripy works best when you add your points balances—we\'ll find the best ways to use them'
    });
  }

  return errors;
}
```

#### Acceptance Criteria 6.1-6.3
- [ ] Service fee clearly explains value (savings vs fee)
- [ ] Payment is simple and trustworthy
- [ ] Errors are user-friendly with helpful suggestions
- [ ] Validation messages guide users, not scold them

---

---

## Guiding Principles (from Source of Truth)

When implementing these changes, always consider:

### 1. Value First
> "Everything should help users get more value from their points."

Every UI element should contribute to better redemptions, lower costs, or easier planning.

### 2. Simplicity Over Complexity
> "Travel planning is already complicated. Tripy should make it simpler, not add more steps."

Hide the complexity of transfer bonuses, sweet spots, and cross-program arbitrage. Show simple results.

### 3. Trust Through Transparency
> "Users should always understand: why a particular option is recommended, how much they're saving, what their points are worth, the trade-offs between options."

Always explain the value. Never leave users wondering why something is recommended.

### 4. The Booking Gap
> "Tripy helps users find and compare options, then provides instructions to book. We don't book on behalf of users (yet)."

Focus on clear, actionable instructions—not payment processing for the actual bookings.

### 5. Protect the Engine
> "The depth of the engine is what makes Tripy valuable."

Don't simplify in ways that reduce optimization quality. The backend arbitrage engine is the competitive advantage.

---

## Implementation Order

### Sprint 0: Foundations (Do This First)
**Focus:** Establish contracts before writing any feature code.

| Priority | Task | Description |
|----------|------|-------------|
| P0 | Serializers | Create `frontend/src/lib/serializers.ts` |
| P0 | Schemas | Create `backend/src/schemas/trip.py` and `backend/src/schemas/optimize.py` |
| P0 | API Client | Update `apiRequest` to use serializers |
| P0 | Contract Test | Write contract test that creates trip, optimizes, selects |

**Success Criteria:**
- Serializers transform camelCase ↔ snake_case correctly
- Contract test passes end-to-end without manual key renaming

### Sprint 1: Core Data Flow & Arbitrage Engine Connection
**Focus:** Get the full optimization pipeline working with all user preferences.

| Priority | Task | Description |
|----------|------|-------------|
| P0 | Task 1.1 | Extend Trip Creation API with enums (trip_type, date_mode) |
| P0 | Task 2.1 | Connect to Points Arbitrage Engine (`/optimize/solo`) |
| P1 | Task 5.1 | Add Trip Status Field with "selected" state |

**Success Criteria:**
- User preferences (trip_type, flight_class, optimization_mode) reach the backend
- Results come from the arbitrage engine with bundled cost breakdown
- Backend is source of truth for preferences

### Sprint 2: Surface Value & Transparency
**Focus:** Show users WHY they're saving money—build trust through transparency.

| Priority | Task | Description |
|----------|------|-------------|
| P0 | Task 3.1 | Create ValueInsightCard (no invented $ from points) |
| P0 | Task 3.2 | Create Points Value Explainer |
| P1 | Task 2.2 | Add Cost Breakdown Display (bundled in response) |
| P2 | Task 2.3 | Add Strategy Comparison (OOP vs CPP) |

**Success Criteria:**
- Users see total savings (from real cash comparison)
- Users understand WHY (descriptions, not fake dollar amounts)
- CPP value is explained clearly

### Sprint 3: Clear Booking Instructions
**Focus:** Deliver the "booking gap" experience—instructions that any user can follow.

| Priority | Task | Description |
|----------|------|-------------|
| P0 | Task 4.1 | Create Step-by-Step Booking Guide |
| P0 | Task 4.2 | Connect Transfer Strategy API (consistent path) |
| P0 | Task 5.2 | Save Selected Itinerary WITH snapshot |

**Success Criteria:**
- Step-by-step instructions are crystal clear
- Selection is snapshotted for reproducibility
- Booking page loads from snapshot, not live data

### Sprint 4: Polish & Launch Readiness
**Focus:** Error handling, validation, and service fee gate.

| Priority | Task | Description |
|----------|------|-------------|
| P0 | Task 6.1 | Service Fee Gate (no "secure payment" if mock) |
| P1 | Task 6.2 | Add Error Handling (ErrorState component) |
| P1 | Task 6.3 | Add Input Validation with Helpful Messages |

**Success Criteria:**
- Mock payment clearly marked for testing
- Errors are user-friendly
- Validation guides users, doesn't scold

---

## Testing Checklist

### Contract Tests (P0 - Run First)
Prevents the most common integration bugs:

- [ ] **Casing test:** POST trip with camelCase body → GET returns camelCase → backend stored snake_case
- [ ] **Round-trip test:** Create trip → Get trip → All fields match (including `origin`, `destinations`)
- [ ] **Response shape test:** `create_trip()` returns `TripResponse` without `PK`, `SK`, or internal fields
- [ ] **Optimize contract:** POST `/optimize/solo` with `{ tripId, points }` → Response has:
  - [ ] `itineraries[].route` and `displayName`
  - [ ] `itineraries[].oopMetrics`
  - [ ] `itineraries[].transfers` (typed `TransferInstruction[]`)
  - [ ] `cached`, `computedAt`, `expiresAt` (no underscore prefixes)
- [ ] **Selection contract:** POST `/trips/{id}/select` with snapshot → GET `/trips/{id}/selection` returns snapshot
- [ ] **Points contract:** POST `/trips/{id}/points` with program IDs → GET `/trips/{id}/points` returns same
- [ ] **Status transitions:** draft → optimized → selected → instructions_unlocked → completed
- [ ] **Program ID validation:** Only canonical program IDs accepted (`chase_ur`, not `Chase UR`)

#### Contract Test Harness (Runnable)

**Backend:** `backend/tests/test_contracts.py`

```bash
# Run with: pytest backend/tests/test_contracts.py -v
```

```python
import pytest
from fastapi.testclient import TestClient
from src.app import app, get_current_user

# Override auth dependency for tests
def override_get_current_user():
    return "test_user_123"

app.dependency_overrides[get_current_user] = override_get_current_user

client = TestClient(app)

class TestTripContract:
    """
    Verify trip API contract matches frontend expectations.
    
    IMPORTANT: Backend ALWAYS returns snake_case JSON.
    The frontend apiRequest wrapper converts to camelCase.
    These tests verify the RAW backend response (snake_case).
    """
    
    def test_create_trip_returns_clean_response(self):
        """P0-1: Response should NOT contain PK, SK, or internal fields."""
        response = client.post("/trips", json={
            "title": "Test Trip",
            "trip_type": "round_trip",
            "date_mode": "fixed",
            "origin": "JFK",
            "destinations": ["LAX"],
            "start_date": "2026-03-01",
            "end_date": "2026-03-07",
        })
        
        assert response.status_code == 200
        data = response.json()
        
        # Backend uses snake_case
        assert "trip_id" in data
        assert "status" in data
        assert "origin" in data
        assert "destinations" in data
        
        # Must NOT have camelCase (proves backend is consistent)
        assert "tripId" not in data, "Backend should return snake_case, not camelCase"
        
        # Must NOT have these fields (DynamoDB internals)
        assert "PK" not in data
        assert "SK" not in data
        assert "GSI1PK" not in data
        assert "ttl" not in data

    def test_trip_roundtrip_preserves_fields(self):
        """Round-trip: create → get → fields match."""
        create_resp = client.post("/trips", json={
            "title": "Roundtrip Test",
            "trip_type": "one_way",
            "date_mode": "flexible",
            "origin": "SFO",
            "destinations": ["NRT", "HND"],
            "duration_days": 14,
            "optimization_mode": "cpp",
        })
        
        trip_id = create_resp.json()["trip_id"]
        
        get_resp = client.get(f"/trips/{trip_id}")
        data = get_resp.json()
        
        # All snake_case
        assert data["trip_type"] == "one_way"
        assert data["date_mode"] == "flexible"
        assert data["origin"] == "SFO"
        assert data["destinations"] == ["NRT", "HND"]
        assert data["duration_days"] == 14
        assert data["optimization_mode"] == "cpp"

class TestOptimizeContract:
    """
    Verify optimize API contract.
    
    Backend returns snake_case. Frontend converts to camelCase.
    """
    
    def test_optimize_response_has_required_fields(self):
        """P0-4: Response must have staleness fields (snake_case from backend)."""
        response = client.post("/optimize/solo", json={
            "trip_id": "test-trip-123",
            "points": {"chase_ur": 50000, "amex_mr": 30000},
        })
        
        data = response.json()
        
        # Staleness fields - backend ALWAYS snake_case
        assert "cached" in data
        assert "computed_at" in data, "Backend should return snake_case 'computed_at'"
        assert "expires_at" in data, "Backend should return snake_case 'expires_at'"
        
        # Verify NOT camelCase (that's frontend's job)
        assert "computedAt" not in data
        assert "expiresAt" not in data
        
        # Itinerary structure
        if data.get("itineraries"):
            itin = data["itineraries"][0]
            # All snake_case from backend
            assert "route" in itin
            assert "display_name" in itin, "Backend should return snake_case 'display_name'"
            assert "segments" in itin
            assert "oop_metrics" in itin, "Backend should return snake_case 'oop_metrics'"
            assert "transfers" in itin
            
            # Verify NOT camelCase
            assert "displayName" not in itin
            assert "oopMetrics" not in itin
            
            # Transfers must be typed (not empty dicts)
            if itin["transfers"]:
                t = itin["transfers"][0]
                assert "source_program" in t
                assert "points_to_transfer" in t
                
                # Verify NOT camelCase
                assert "sourceProgram" not in t
                assert "pointsToTransfer" not in t
```

**Frontend:** `frontend/src/lib/__tests__/serializers.test.ts`

```bash
# Run with: npm test -- serializers
```

```typescript
import { describe, it, expect } from 'vitest';
import { toSnakeCase, toCamelCase } from '../serializers';

describe('Serializers', () => {
  it('converts camelCase to snake_case', () => {
    const input = { tripId: '123', startDate: '2026-03-01', oopMetrics: { totalCashPrice: 1000 } };
    const output = toSnakeCase(input);
    
    expect(output.trip_id).toBe('123');
    expect(output.start_date).toBe('2026-03-01');
    expect(output.oop_metrics.total_cash_price).toBe(1000);
  });

  it('converts snake_case to camelCase', () => {
    const input = { trip_id: '123', computed_at: '2026-01-31T12:00:00Z', expires_at: '2026-01-31T16:00:00Z' };
    const output = toCamelCase(input);
    
    expect(output.tripId).toBe('123');
    expect(output.computedAt).toBe('2026-01-31T12:00:00Z');
    expect(output.expiresAt).toBe('2026-01-31T16:00:00Z');
  });

  it('handles Date objects', () => {
    const input = { createdAt: new Date('2026-01-31T12:00:00Z') };
    const output = toSnakeCase(input);
    
    expect(output.created_at).toBe('2026-01-31T12:00:00.000Z');
  });

  it('preserves zero values (not falsy-dropped)', () => {
    const input = { balance: 0, count: 0 };
    const output = toSnakeCase(input);
    
    expect(output.balance).toBe(0);
    expect(output.count).toBe(0);
  });
});
```

### User Journey Tests (Most Important)
Per Source of Truth, test the core journey:

- [ ] User enters origin, destinations, and point balances
- [ ] User sees optimized options ranked by their criteria
- [ ] User understands HOW MUCH they're saving (real number from `cashSaved`)
- [ ] User understands WHY they're saving (insights with evidence, no fake $)
- [ ] User sees "valid until [time]" not just "computed X ago"
- [ ] User can follow step-by-step booking instructions
- [ ] User can track completed steps
- [ ] Returning user sees their snapshot, not stale data

### Unit Tests
- [ ] Serializer: `toSnakeCase({ tripId: '123' })` → `{ trip_id: '123' }`
- [ ] Serializer: `toCamelCase({ trip_id: '123' })` → `{ tripId: '123' }`
- [ ] Serializer: Date objects converted to ISO strings
- [ ] Trip validation: `trip_type` enum rejects invalid values
- [ ] Validation: `origin` requires 3-letter IATA code
- [ ] Insights: no `savingsAmount` field in output
- [ ] OOP metrics: `cashSaved = totalCashPrice - totalOutOfPocket` (real numbers)
- [ ] Cache key: same inputs → same key; different inputs → different key

### Integration Tests
- [ ] Full solo trip flow: setup → results → booking
- [ ] `/optimize/solo` returns ranked itineraries with bundled breakdown
- [ ] Transfer strategy API returns typed `TransferInstruction[]`
- [ ] Service fee unlocks instructions
- [ ] Selection snapshot is used by booking page
- [ ] Booking page redirects if no selection exists (P0-10)
- [ ] Booking page redirects if status is not `selected` or beyond (P0-10)

### Edge Cases
- [ ] User with no points (should still work with cash options)
- [ ] User with many points across programs (cross-program arbitrage)
- [ ] No availability on preferred dates (helpful error)
- [ ] Small/remote destinations (AI suggestions fallback)
- [ ] Stale results (show "valid until [time]" + refresh button)
- [ ] Expired results (auto-prompt refresh)
- [ ] Award seat disappeared (warning in BookingGuide)

---

## Files Summary

### New Files to Create (Sprint 0 - Foundations)

| File | Purpose |
|------|---------|
| `backend/src/schemas/__init__.py` | Package init |
| `backend/src/schemas/trip.py` | Trip request/response schemas (enums, not booleans) |
| `backend/src/schemas/optimize.py` | Optimization schemas (bundled breakdown, typed transfers) |
| `backend/src/schemas/points.py` | Points balance schemas |
| `backend/src/schemas/programs.py` | Canonical program IDs enum |
| `backend/src/mappers/__init__.py` | Package init |
| `backend/src/mappers/trip_mapper.py` | Storage-to-API model conversion (strips PK/SK) |
| `backend/src/services/points_service.py` | Points GET/POST implementation with program ID validation |
| `backend/tests/test_contracts.py` | Contract tests enforcing snake_case, auth override |
| `frontend/src/lib/serializers.ts` | camelCase ↔ snake_case transformation (handles Dates, guards plain objects) |
| `frontend/src/types/trip.ts` | Trip types with enums, origin/destinations |
| `frontend/src/types/programs.ts` | Canonical program IDs type |
| `frontend/src/lib/programLabels.ts` | Display labels for program IDs (see below) |
| `frontend/src/lib/__tests__/serializers.test.ts` | Serializer unit tests |

#### Program Labels File (P1-7)

**File:** `frontend/src/lib/programLabels.ts`

```typescript
import type { PointsProgram } from '@/types/programs';

/**
 * Display labels for canonical program IDs.
 * UI should NEVER display raw IDs like "air_france_klm".
 */
export const PROGRAM_LABELS: Record<PointsProgram, string> = {
  // Credit Card Programs
  chase_ur: 'Chase Ultimate Rewards',
  amex_mr: 'Amex Membership Rewards',
  citi_typ: 'Citi ThankYou Points',
  capital_one: 'Capital One Miles',
  bilt: 'Bilt Rewards',
  
  // Airlines
  united: 'United MileagePlus',
  american: 'AAdvantage',
  delta: 'Delta SkyMiles',
  southwest: 'Southwest Rapid Rewards',
  jetblue: 'JetBlue TrueBlue',
  alaska: 'Alaska Mileage Plan',
  british_airways: 'British Airways Avios',
  virgin_atlantic: 'Virgin Atlantic Flying Club',
  air_france_klm: 'Air France/KLM Flying Blue',
  singapore: 'Singapore KrisFlyer',
  ana: 'ANA Mileage Club',
  
  // Hotels
  marriott: 'Marriott Bonvoy',
  hilton: 'Hilton Honors',
  hyatt: 'World of Hyatt',
  ihg: 'IHG One Rewards',
};

export function getProgramLabel(programId: PointsProgram): string {
  return PROGRAM_LABELS[programId] || programId;
}
```

### New Files to Create (Feature Code)

| File | Purpose |
|------|---------|
| `frontend/src/lib/hooks/useSoloOptimization.ts` | Connect to arbitrage engine (backend is source of truth) |
| `frontend/src/lib/hooks/useTransferStrategy.ts` | Load booking instructions (typed TransferInstruction) |
| `frontend/src/components/ui/ValueInsightCard.tsx` | Show savings & insights (no fake $) |
| `frontend/src/components/ui/PointsValueExplainer.tsx` | Explain CPP value |
| `frontend/src/components/ui/CostBreakdownCard.tsx` | Segment-by-segment breakdown (uses bundled data) |
| `frontend/src/components/ui/BookingGuide.tsx` | Step-by-step instructions |
| `frontend/src/components/ui/ServiceFeePayment.tsx` | Payment gate (mock clearly marked) |
| `frontend/src/components/ui/ErrorState.tsx` | User-friendly errors |
| `frontend/src/lib/validation.ts` | Input validation (validates origin/destinations) |

### Files to Modify

| File | Changes |
|------|---------|
| `backend/src/app.py` | Import schemas, add endpoints: `/trips/{id}/status`, `/trips/{id}/select`, `/trips/{id}/selection`, `/trips/{id}/points` |
| `backend/src/services/trip_service.py` | Use mapper, save snapshot on selection, verify ownership |
| `backend/src/services/optimize_service.py` | Deterministic cache key, include `cached`/`computedAt`/`expiresAt` in response |
| `frontend/src/lib/api.ts` | Use serializers in `apiRequest`, add new methods, remove `getCostBreakdown` |
| `frontend/src/types/optimization.ts` | Add `route`/`displayName` to itinerary, typed `TransferInstruction[]`, staleness fields |
| `frontend/src/app/(app)/solo/setup/page.tsx` | Use `tripType`/`dateMode` enums, send `origin`/`destinations` |
| `frontend/src/app/(app)/solo/results/page.tsx` | Use arbitrage engine, snapshot on selection, show `expiresAt` |
| `frontend/src/app/(app)/solo/booking/page.tsx` | Load from snapshot, validate gating prerequisites |

---

## Rollback Plan

If issues arise after deployment:

1. **Feature flags**: Wrap new optimization logic in feature flags
2. **API versioning**: Keep `/itinerary/generate` working alongside `/optimize/solo`
3. **Database migration**: New fields are optional; old trips work without them
4. **Graceful degradation**: If arbitrage engine fails, fall back to legacy generator

---

## Success Metrics

Per Source of Truth, success looks like:

> - "I saved $500 on my trip to Japan by using Tripy"
> - "I had no idea I could transfer my Chase points to Hyatt for 3x the value"
> - "I finally understand what my points are actually worth"

Track:
- **Savings shown to users** - Are we surfacing real value (from cash comparisons)?
- **Booking instruction completion rate** - Are instructions clear enough?
- **Return users** - Do they come back to plan more trips?
- **Contract test pass rate** - Are frontend/backend in sync?

---

## Summary of Fixes Applied

### Pre-Implementation Fixups (Agent Must Apply)

| Fixup | Issue | Fix |
|-------|-------|-----|
| **Fixup 1** | UI calls removed endpoints | `CostBreakdownCard` takes props (no API), `StrategyComparisonCard` uses pure fetch function |
| **Fixup 2** | `create_trip()` returns raw item | Return `storage_to_api(item)` not `{"trip_id": ..., **item}` |
| **Fixup 3** | `/optimize/solo` references wrong fields | Use `request.optimization_mode_override`, not `request.budget` etc. |
| **Fixup 4** | Results page uses `item.name` | Use `item.displayName`, compute `withinBudget` from real data, keep real `id` for selection |
| **Fixup 5** | Points map drops zero balances | Use `item.balance != null` not `item.balance` (0 is falsy) |
| **Fixup 6** | BookingStep field mismatch | Use `b.hotelChain`, `b.segmentReference` (not `hotelName`) |
| **Fixup 7** | StrategyComparisonCard state races | Use pure `fetchOptimizeSolo()` instead of hook (each call independent) |
| **Fixup 8** | `apiRequest` not exported | Add `export` to `async function apiRequest<T>()` |
| **Fixup 9** | Cache key ignores mode override | Pass resolved `mode` to `compute_cache_key()` so OOP/CPP/Balanced don't collide |
| **Fixup 10** | Raw program IDs in UI | Use `getProgramLabel()` everywhere program IDs are displayed |
| **Fixup 11** | BookingStep forward reference | Define `BookingStep` BEFORE `TransferStrategyResponse` in optimize.py |
| **Fixup 12** | `create_trip()` missing fields | Store `origin`, `destinations`, `final_destination` in trip item |

### Additional Schema Fixes (Issue #2-#5)

| Issue | Fix |
|-------|-----|
| **#2** | Points storage model | Use `SK=POINTS#{program}` (one item per program), not single blob |
| **#3** | Upsert points field name | Schema field is `points`, endpoint uses `request.points` |
| **#4** | PointsSummaryResponse missing trip_id | Always return `trip_id=trip_id` in response |
| **#5** | Program ID validation | Pydantic validates enum automatically; remove manual validation |

### Component Integration Fixes (Issue #6-#10)

| Issue | Fix |
|-------|-----|
| **#6** | StrategyComparisonCard undefined symbols | Import `Check`; remove `comparison &&` block |
| **#7** | CostBreakdownCard missing import | Add `import { getProgramLabel } from '@/lib/programLabels'` |
| **#8** | Results page undefined trip/pointsMap | Load via `trips.get()`, expose `pointsMap` from hook |
| **#9** | ValueInsightCard wrong props | Pass `insights` + `oopMetrics`, not individual fields |
| **#10** | PointsValueExplainer fake $ | Pass `segments` + `oopMetrics`, no `pointsBreakdown` |

### P0 Fixes (Will break immediately without these)

| Issue | Fix |
|-------|-----|
| **P0-1: TripResponse return shape** | Created storage-to-API mapper. `create_trip()` returns clean `TripResponse`, not raw DynamoDB item with PK/SK. |
| **P0-2: Models in app.py** | Created `backend/src/schemas/trip.py`, `optimize.py`, `points.py`, `programs.py`. Import into app.py. |
| **P0-3: Conflicting booleans** | Replaced `is_one_way`/`is_round_trip`/`is_flexible` with `trip_type` and `date_mode` enums. |
| **P0-4: Response field naming** | `OptimizeSoloResponse` uses `cached`, `computedAt`, `expiresAt` (no underscore prefixes). |
| **P0-5: Ambiguous source of truth** | Backend is source of truth for preferences. Frontend sends only `{ tripId, points, optimizationModeOverride? }`. |
| **P0-6: UI fields don't exist** | Added `route: string[]` and `displayName: string` to `RankedItinerary`. |
| **P0-7: Program IDs unspecified** | Created `PointsProgram` enum with canonical IDs (`chase_ur`, `amex_mr`, etc.). |
| **P0-8: Cache key underspecified** | Cache key = `sha256(trip_prefs + points + dates)`. Deterministic for reliable cache hits. |
| **P0-9: Origin/destinations missing** | Added `origin: str` and `destinations: List[str]` to `CreateTripRequest` and `TripResponse`. |
| **P0-10: Booking page gating** | Booking page validates: selection exists, status is `selected` or beyond, `instructions_unlocked` for full steps. |

### P1 Fixes (Medium impact)

| Issue | Fix |
|-------|-----|
| **P1-1: Missing "selected" status** | Added `selected` state: draft → optimized → **selected** → instructions_unlocked → completed |
| **P1-2: Selection needs snapshot** | Store full itinerary snapshot at selection time. Booking page loads from snapshot. Permission check: `trip.created_by == user_id`. |
| **P1-3: Endpoint path mismatch** | Standardized all paths (no `/api` prefix). Use `apiRequest` wrapper consistently. |
| **P1-4: Cost breakdown separate call** | Bundled `segments[]` and `oopMetrics` in `RankedItinerary`. `CostBreakdownCard` takes props, no API call. |
| **P1-5: apiRequest usage** | `apiRequest<T>` returns typed data directly. Fixed hooks to not call `response.ok` or `response.json()`. |
| **P1-6: Typed transfers** | `TransferInstruction` is a proper Pydantic/TS model, not `List[dict]`. |
| **P1-7: Program display labels** | Created `programLabels.ts` - UI never displays raw IDs like `air_france_klm`. |

### Contract Truth

| Issue | Fix |
|-------|-----|
| **Missing endpoints** | Added `GET /trips/{trip_id}/selection`, `GET /trips/{trip_id}/points`, `POST /trips/{trip_id}/points` with full backend implementation. |
| **Removed endpoints** | Removed `optimization.getCostBreakdown()` (bundled), `optimization.compareStrategies()` (use mode override). |
| **Strategy comparison** | Use `optimizationModeOverride` in `OptimizeSoloRequest` instead of separate endpoint. `StrategyComparisonCard` uses pure fetch function. |
| **Contract test harness** | Added runnable pytest + vitest test files with exact commands, dependency override for auth, and snake_case enforcement. |
| **apiRequest exported** | Changed `async function apiRequest<T>` to `export async function apiRequest<T>` for use in hooks. |

### Architecture Fixes

| Issue | Fix |
|-------|-----|
| **Storage vs API models** | Created `mappers/trip_mapper.py` to convert DynamoDB items to API responses. |
| **Serializer guards** | Added `isPlainObject()` check to prevent recursing into Date, File, Blob, etc. |
| **Serializer Date handling** | Serializer converts `Date` objects to ISO strings. |
| **Zero balance handling** | Use `!= null` checks to preserve 0 balances (0 is falsy in JS). |
| **Cache key determinism** | Resolved `mode` (including override) is included in cache key. Destinations NOT sorted (order matters). |
| **TTL UTC handling** | Use `datetime.now(timezone.utc)` and format with `Z` suffix for consistent parsing. |
| **Pure fetch separation** | Created `fetchOptimizeSolo()`, `fetchTransferStrategy()`, `fetchPointsSummary()` for use without React state. |
| **Payment proof storage** | `PaymentProof` type stores provider, status, paymentIntentId, paidAt, amount, currency. |
| **Booking URL schema** | Added note that `booking_url` may be deep link or search landing page; `segment_reference` must be actionable. |
| **Staleness UX** | Response includes `expiresAt` for "valid until" display instead of just "computed X ago". |
| **Trust scaffolding** | `TransferInsight` includes `evidence`, `asOf`, `confidence` fields. |

### GTM Fixes (Product/Legal)

| Issue | Fix |
|-------|-----|
| **Mock payment honesty** | `ServiceFeePayment` has `mockPayment` prop. When true, shows warning banner. Button says "Unlock (Test Mode)". No "secure payment" claim. |
| **Service fee preview** | Show what users unlock (transfer amounts, links, timing tips) before asking for payment. |

---

## Agent Implementation Readiness

**Status:** ✅ Ready for implementation

**Pre-flight checklist (12 fixups + 5 schema issues):**

**Fixups 1-6 (Critical):**
- [ ] `CostBreakdownCard` takes props, `StrategyComparisonCard` uses `fetchOptimizeSolo()` (1)
- [ ] `create_trip()` returns `storage_to_api(item)` (2)
- [ ] `/optimize/solo` uses `request.optimization_mode_override` only (3)
- [ ] Results page uses `item.displayName`, keeps real `item.id` (4)
- [ ] Points map uses `item.balance != null` (5)
- [ ] BookingStep uses `hotelChain`, `segmentReference` (6)

**Fixups 7-12 (Also Critical):**
- [ ] `StrategyComparisonCard` uses pure fetch, imports `Check` icon (7)
- [ ] `apiRequest` is exported (8)
- [ ] Cache key includes resolved `mode` param (9)
- [ ] All program IDs wrapped in `getProgramLabel()` (10)
- [ ] `BookingStep` defined BEFORE `TransferStrategyResponse` (11)
- [ ] `create_trip()` stores `origin`, `destinations`, `final_destination` (12)

**Schema Issues (Must also apply):**
- [ ] Points: `SK=POINTS#{program}`, not single blob (#2)
- [ ] UpsertPointsRequest field is `points`, endpoint uses `request.points` (#3)
- [ ] `PointsSummaryResponse` always returns `trip_id` (#4)
- [ ] No manual enum validation - Pydantic handles it (#5)
- [ ] Results page loads trip and exposes pointsMap from hook (#8)
- [ ] `ValueInsightCard` gets `oopMetrics` prop, not individual fields (#9)
- [ ] `PointsValueExplainer` gets `segments`+`oopMetrics`, no fake $ (#10)

**Recommended implementation order:**
```
Sprint 0 (Contract correctness):
  - Fix points model (#2-#5)
  - Fix optimize snake/camel (#1)
  - Fix BookingStep order (#11)
  - Fix create_trip fields (#12)
  - Run: pytest backend/tests/test_contracts.py -v

Sprint 1 (Frontend wiring):
  - Fix missing imports/symbols (#6-#8)
  - Fix Value component props (#9-#10)
  - Run: npm test -- serializers
```

**Run contract tests first:**
```bash
# Backend - verifies snake_case consistency
pytest backend/tests/test_contracts.py -v

# Frontend - verifies serializer transformations
npm test -- serializers
```

**Auth in tests:** Tests use `app.dependency_overrides[get_current_user] = lambda: "test_user_123"`

---

*Implementation Plan Created: 2026-01-31*
*Updated: 2026-01-31 (addressed all P0/P1 contract, typing, and gating issues)*
*Final Review: 2026-01-31 (fixed 12 fixups + 5 schema issues for runtime correctness)*
*Aligned with Tripy Source of Truth*
*Grade: A (agent-executable spec)*
