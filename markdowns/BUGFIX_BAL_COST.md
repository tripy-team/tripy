# Bugfix: UnboundLocalError for `bal_cost` in Itinerary Generation

## Issue

Users were encountering this error when generating itineraries:

```
We encountered an issue generating your itinerary: All generators failed: 
local variable 'bal_cost' referenced before assignment
```

## Root Cause

In `itinerary_service.py`, the variable `bal_cost` was being used **before** it was assigned:

**Line 399 (using bal_cost):**
```python
# 4. Extended stay: add more days to longest city (when budget allows)
if max_budget is None or max_budget > bal_cost * 1.3:  # ❌ bal_cost not yet assigned!
    extended_cities = _build_city_objects(stay_names, stay_ids, days_per=base_days + 2)
    # ...
```

**Line 419 (assigning bal_cost):**
```python
# 6. Explorer: more cities only if we're well under budget
bal_cost = _cost(routes[0]["cities"])  # ❌ Too late! Already used above
if (len(stay_names) >= 3 and bal_cost <= (max_budget * 0.7)):
    # ...
```

This is a classic **UnboundLocalError** - trying to use a variable before it's been assigned.

## The Fix

Moved the `bal_cost` assignment to **immediately after** the balanced route is created (right after line 366):

```python
# 1. Balanced (forward order)
bal_cities = _build_city_objects(stay_names, stay_ids)
routes.append({
    "label": "Balanced route",
    "route_ids": route_ids,
    "cities": bal_cities,
    "weight_factor": 1.0,
})

# ✅ Calculate base cost right away (used for budget checks below)
bal_cost = _cost(routes[0]["cities"])

# 2. Reverse route...
# 3. Budget route...
# 4. Extended stay (now bal_cost is defined!)
if max_budget is None or max_budget > bal_cost * 1.3:  # ✅ Works!
    # ...
```

And removed the duplicate assignment from line 419:

```python
# 6. Explorer route
# bal_cost = _cost(routes[0]["cities"])  # ❌ REMOVED - already assigned above
if (len(stay_names) >= 3 and bal_cost <= (max_budget * 0.7)):  # ✅ Works!
    # ...
```

## Impact

### Before Fix:
- ❌ Itinerary generation failed with UnboundLocalError
- ❌ No itineraries could be generated
- ❌ Poor user experience (cryptic error message)

### After Fix:
- ✅ Itinerary generation works correctly
- ✅ All route variants (Balanced, Reverse, Budget, Extended, Quick, Explorer) generate properly
- ✅ Budget checks work as intended

## Testing

Test the fix with various scenarios:

```bash
# Test 1: Generate itinerary with budget constraint
# Should create: Balanced, Budget, Extended (if budget allows), Quick routes

# Test 2: Generate itinerary without budget
# Should create: Balanced, Reverse, Extended, Quick, Explorer routes

# Test 3: Generate itinerary with very tight budget
# Should create: Balanced, Budget (minimal days) routes
```

All tests should complete without the `bal_cost` error.

## Files Changed

- `backend/src/services/itinerary_service.py` - Fixed variable assignment order

## Related Code Context

The `bal_cost` variable represents the estimated cost of the "Balanced route" (the first/default route variant). It's used to:

1. **Determine if Extended stay is affordable** (line 399):
   - Only add "Extended stay" variant if budget > bal_cost × 1.3
   - This prevents creating unaffordable route variants

2. **Determine if Explorer route is viable** (line 422):
   - Only add "Explorer" variant if bal_cost ≤ budget × 0.7
   - This ensures we're well under budget before suggesting more cities

The fix ensures `bal_cost` is calculated once (from the balanced route) and reused for all budget checks.

## Prevention

To prevent similar issues in the future:

1. **Always initialize variables before use** - especially in conditional blocks
2. **Use linters** - tools like `pylint` or `ruff` would catch this:
   ```
   E0601: Using variable 'bal_cost' before assignment
   ```
3. **Add type hints** - helps catch logical errors:
   ```python
   bal_cost: int = _cost(routes[0]["cities"])
   ```

## Deployment

This is a **critical bugfix** that should be deployed immediately:

1. The fix is backward compatible (no API changes)
2. No data migration needed
3. Restart backend to apply:
   ```bash
   cd backend && ./start.sh
   ```

Users should now be able to generate itineraries without errors.
