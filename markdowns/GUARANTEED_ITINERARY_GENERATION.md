# Guaranteed Itinerary Generation

## Overview

This document describes the comprehensive failsafe system that ensures itinerary generation **never fails completely**. The system now has multiple fallback layers with automatic budget adjustment to always provide users with actionable trip suggestions.

## Problem Solved

**Before:** Users would see "no routes found" when:
- Budget was too low
- Flights weren't available
- Optimization failed for any reason
- Destinations or dates were invalid

**After:** System always returns itineraries with clear warnings about what needs to be adjusted.

## Multi-Layer Fallback Architecture

The system now has 5 layers of fallback, each progressively more lenient:

### Layer 1: Optimized Itinerary (Ideal)
**Function:** `generate_optimized_itinerary()`
- Fetches real flights from SERP and AwardTool APIs
- Runs ILP optimization with user's budget
- Returns detailed payment instructions with specific flights

**Falls to Layer 2 if:**
- ILP returns "Infeasible" status
- User's budget is too restrictive
- No valid paths found in solution

### Layer 2: Smart Budget Relaxation (Optimized)
**Automatic budget adjustment based on actual costs**

**Smart Budget Calculation:**
```python
# Find minimum flight cost from actual flight data
min_route_cost = min(edge["cash_cost"] for edge in edges_all)

# Estimate total based on route segments
num_segments = len(city_codes) + 1
smart_budget = min_route_cost * num_segments * 1.3  # 30% buffer
```

**Multiplier Fallbacks:** If smart budget fails, tries 2x, 3x, 5x, 10x user's budget

**User sees:**
```
Your budget of $2,000 is too low for this trip.
We found a route with a budget of $4,500 (total cash: $4,200).
Consider increasing your budget to at least $4,500 or adding more points.
```

**Falls to Layer 3 if:** All budget attempts still return "Infeasible"

### Layer 3: Best-Effort Path (Cash-Only)
**Function:** `_best_effort_path_from_edges()`
- Uses Dijkstra's algorithm to find minimum-cost path
- Ignores budget and points constraints
- Returns cheapest possible route

**User sees:**
```
Your budget of $2,000 is insufficient.
The lowest-cost route we found costs $5,200.
We recommend a budget of at least $6,240.
```

**Falls to Layer 4 if:** No path exists in flight graph (e.g., disconnected airports)

### Layer 4: Simple Itineraries with Warnings
**Function:** `generate_simple_itineraries(safe_mode=True)`
- Generates estimate-based itineraries without real flight data
- Always succeeds (uses cost formulas instead of flight APIs)
- Provides smart budget recommendations

**Budget Calculation:**
```python
def _calculate_minimum_budget(num_cities, total_days, include_hotels):
    base_cost_per_day = 200 if include_hotels else 120
    base_cost_per_city = 300 if include_hotels else 200
    
    min_days = max(num_cities, total_days // 2)
    min_budget = min_days * base_cost_per_day + num_cities * base_cost_per_city
    
    return int(min_budget * 1.2)  # 20% buffer
```

**User sees:**
- Budget Warning (if budget < min_budget):
```
Your budget of $2,000 may be too low for this trip.
We recommend at least $4,800 for 3 cities over 10 days (with hotels).
The itineraries shown above may exceed your budget.

Your Budget: $2,000
Recommended: $4,800
```

- Optimization Warning:
```
We couldn't optimize your itinerary with real flight data.
This usually means your budget is too low or flights aren't available for your dates.
The routes shown are estimates. Consider increasing your budget or choosing different dates/airports.
```

**Falls to Layer 5 if:** Trip has no destinations or critical data missing (extremely rare)

### Layer 5: Minimal Fallback (Last Resort)
**Function:** `_generate_minimal_fallback_itinerary()`
- Returns a placeholder itinerary with default values
- Always succeeds no matter what

**User sees:**
```
We encountered an issue generating your itinerary: [reason].
Please ensure your trip has valid destinations, dates, and budget settings.
The estimate shown above is a placeholder.

Basic route estimate
Your destination: 7 days
Estimated cost: $3,000 / 75,000 points
```

**Never fails** - This is the absolute guaranteed fallback.

## Smart Budget Recommendations

### Budget Too Low Warning

When user's budget is below the calculated minimum:

**Backend calculates:**
```python
min_budget = _calculate_minimum_budget(
    num_cities=len(stay_names),
    total_days=total_days,
    include_hotels=trip.get("includeHotels", True)
)

if user_budget < min_budget:
    # Create budget_warning item
```

**Frontend displays:**
```
┌─────────────────────────────────────────────────────┐
│ ⚠️ Budget Too Low                                   │
│                                                      │
│ Your budget of $2,000 may be too low for this trip. │
│ We recommend at least $4,800 for 3 cities over 10   │
│ days (with hotels). The itineraries shown above may  │
│ exceed your budget.                                  │
│                                                      │
│ Your Budget: $2,000     Recommended: $4,800         │
└─────────────────────────────────────────────────────┘
```

### Relaxed Budget Success

When optimization succeeds with higher budget:

```
Your budget of $2,000 is too low for this trip.
We found a route with a budget of $4,500 (total cash: $4,200).
Consider increasing your budget to at least $4,500 or adding more points.
```

**User still gets:** Full itinerary with real flights and transfer instructions

## API Response Structure

All fallback responses are structured identically to maintain frontend compatibility:

```json
{
  "status": "simple_fallback",
  "solution": {},
  "items": [
    {
      "tripId": "trip-123",
      "itemId": "itinerary_1",
      "type": "itinerary",
      "name": "Budget pick",
      "route": ["uuid-1", "uuid-2", "uuid-3"],
      "cities": [
        {"name": "Paris", "days": 5},
        {"name": "Rome", "days": 4}
      ],
      "totalCost": 3500,
      "pointsCost": 87500,
      "score": 85,
      "withinBudget": false,
      "withinPoints": true
    },
    {
      "tripId": "trip-123",
      "itemId": "budget_warning",
      "type": "budget_warning",
      "message": "Your budget of $2,000 may be too low...",
      "user_budget": 2000,
      "recommended_budget": 4800
    }
  ],
  "fallback_reason": "optimization_error",
  "warning": "Optimization failed: Budget too restrictive"
}
```

## Safe Mode

The simple generator now has `safe_mode` parameter:

```python
def generate_simple_itineraries(trip_id: str, safe_mode: bool = False):
    """
    safe_mode=True: Never raises exceptions, always returns something
    """
```

**With safe_mode=True:**
- Trip not found → returns minimal fallback
- No destinations → returns minimal fallback  
- All destinations excluded → returns minimal fallback
- Any other error → returns minimal fallback

**Never fails completely**

## Warning Types

The system now generates 3 types of warnings:

### 1. Budget Warning (`budget_warning`)
```json
{
  "type": "budget_warning",
  "message": "Your budget of $2,000 may be too low for this trip...",
  "user_budget": 2000,
  "recommended_budget": 4800
}
```

**Displayed:** Red banner at top of results page with budget comparison

### 2. Optimization Warning (`optimization_warning`)
```json
{
  "type": "optimization_warning",
  "message": "We couldn't optimize your itinerary with real flight data..."
}
```

**Displayed:** Amber banner explaining estimates are used instead of real flights

### 3. Fallback Warning (`fallback_warning`)
```json
{
  "type": "fallback_warning",
  "message": "We encountered an issue generating your itinerary: [reason]..."
}
```

**Displayed:** Red banner for severe issues (minimal fallback used)

## Frontend Display

The results page now displays warnings prominently:

```tsx
// Budget Warning - Red banner with budget comparison
{budgetWarning && (
    <div className="p-5 bg-red-50 border-2 border-red-300 rounded-xl">
        <h3>Budget Too Low</h3>
        <p>{budgetWarning.message}</p>
        <div>
            Your Budget: ${budgetWarning.user_budget}
            Recommended: ${budgetWarning.recommended_budget}
        </div>
    </div>
)}

// Optimization Warning - Amber banner
{optimizationWarning && (
    <div className="p-4 bg-amber-50 border border-amber-300 rounded-xl">
        <h3>Estimated Routes</h3>
        <p>{optimizationWarning}</p>
    </div>
)}

// Fallback Warning - Red banner for critical issues
{fallbackWarning && (
    <div className="p-4 bg-red-50 border border-red-300 rounded-xl">
        <h3>Unable to Generate Itinerary</h3>
        <p>{fallbackWarning}</p>
    </div>
)}
```

## Cost Calculation Formulas

### With Hotels (default)
```python
base_cost_per_day = 200
base_cost_per_city = 300

total_cost = (total_days * 200) + (num_cities * 300)
# Example: 10 days, 3 cities = (10 * 200) + (3 * 300) = $2,900
```

### Without Hotels
```python
base_cost_per_day = 120  # Flights + activities only
base_cost_per_city = 200

total_cost = (total_days * 120) + (num_cities * 200)
# Example: 10 days, 3 cities = (10 * 120) + (3 * 200) = $1,800
```

### Minimum Budget (with 20% buffer)
```python
min_days = max(num_cities, total_days // 2)
min_budget = (min_days * cost_per_day + num_cities * cost_per_city) * 1.2
```

## Testing Scenarios

### Scenario 1: Budget Too Low
**Input:**
- Budget: $1,000
- Destinations: JFK → Paris → Rome → JFK
- Duration: 10 days

**Expected:**
1. Optimization fails (infeasible)
2. Budget relaxation tries: $2,000, $3,000, $5,000
3. If still fails: Best-effort path
4. If no path: Simple generator with budget warning
5. User sees: "Recommended budget: $4,800"

### Scenario 2: No Flight Data
**Input:**
- Small airport: ITH (Ithaca)
- Destination: Remote location
- Valid budget

**Expected:**
1. Optimization fails (no edges)
2. Falls back to simple generator
3. User sees: Optimization warning + estimated routes

### Scenario 3: Invalid Destinations
**Input:**
- No destinations added
- Or all destinations excluded

**Expected:**
1. Simple generator called with safe_mode=True
2. Returns minimal fallback
3. User sees: Fallback warning + placeholder itinerary

### Scenario 4: Everything Works
**Input:**
- Valid budget: $5,000
- Major airports: JFK → CDG
- Valid dates
- Credit card points added

**Expected:**
1. Optimization succeeds
2. Returns real flights with transfer instructions
3. No warnings shown

## Files Modified

### Backend
1. **`backend/src/services/itinerary_service.py`**
   - Added `_calculate_minimum_budget()` helper
   - Added `_generate_minimal_fallback_itinerary()` last resort
   - Enhanced `generate_simple_itineraries()` with safe_mode
   - Improved budget relaxation with smart budget calculation
   - Added budget warning item generation
   - Budget pick route now works with minimum 1 day per city

2. **`backend/src/app.py`**
   - Updated `/itinerary/generate` endpoint
   - All exceptions now use `safe_mode=True` for simple generator
   - Added minimal fallback as last resort
   - Returns structured warnings in response

### Frontend
3. **`frontend/src/app/(app)/solo/results/page.tsx`**
   - Added state variables for warnings
   - Extract warnings from response items
   - Display 3 types of warnings with appropriate styling
   - Filter out warning items from itinerary list

## Known Edge Cases (All Handled)

| Scenario | Layer Used | User Experience |
|----------|------------|----------------|
| Budget too low | 2 (Smart relaxation) | Sees itinerary with budget recommendation |
| No flights found | 4 (Simple generator) | Sees estimates with optimization warning |
| Tiny airport | 4 (Simple generator) | Sees estimates with note about small airport |
| No destinations | 5 (Minimal fallback) | Sees placeholder with error message |
| Invalid dates | 4 or 5 | Sees fallback with error message |
| No internet/APIs down | 4 or 5 | Sees estimates or fallback |
| Database error | 5 (Minimal fallback) | Sees placeholder (doesn't save to DB) |

## Benefits

1. **Never Shows Empty State**: Users always see something actionable
2. **Clear Guidance**: Budget recommendations are specific and calculated
3. **Progressive Enhancement**: Uses best available data, degrades gracefully
4. **User-Friendly Messages**: Explains what went wrong and how to fix it
5. **Maintains Structure**: All responses use same format for frontend compatibility

## Future Improvements

1. **Persist Budget Recommendations**: Save recommended budget to trip for easy updating
2. **Auto-Adjust Button**: "Update my budget to $4,800" button in warning banner
3. **Partial Success**: Show partial routes when some segments have flights
4. **Flexible Dates**: Auto-suggest nearby dates with better availability
5. **Airport Alternatives**: Suggest nearby major airports for small origins

## Summary

The system now **guarantees** that users always receive trip suggestions, no matter what goes wrong. Through 5 layers of fallback and smart budget calculation, the system provides:

- **Real optimized routes** when everything works
- **Budget-adjusted routes** when budget is low
- **Estimated routes** when flight data unavailable
- **Minimal placeholder** as absolute last resort

Users see clear, actionable warnings about what needs to be fixed to get better results.
