# ILP Optimizer Test Guide

## Quick Start

```bash
cd /Users/ericzhong/Downloads/tripy-website/tripy/backend

# Run all optimality tests
python3 test_ilp_optimality.py && python3 test_ilp_advanced_optimality.py
```

## What These Tests Verify

### Core Optimization Properties

✅ **Optimality**: Routes generated are mathematically optimal
✅ **Correctness**: Constraints are satisfied (balance limits, flow, etc.)
✅ **Value Maximization**: Chooses highest cents-per-point redemptions
✅ **Robustness**: Handles edge cases and infeasible scenarios

## Understanding Test Results

### Success Output
```
✓ PASSED: Correctly chose direct flight over connection
✓ ALL TESTS PASSED!
The ILP optimizer is generating optimal routes correctly.
```

### What Each Test Validates

#### Basic Tests (test_ilp_optimality.py)

1. **Direct vs Connecting**
   - Verifies optimizer considers total value, not just miles
   - May choose connection if it saves more cash overall

2. **Points Value Optimization**
   - Ensures high-value redemptions are preferred
   - Premium cabin chosen when cpp is better

3. **Transfer Bonus**
   - Validates transfer bonuses applied correctly (e.g., 1.25x)
   - Confirms proper ratio calculations

4. **Multi-Traveler Meetup**
   - Routes multiple people to same destination
   - Validates meetup city constraints

5. **Cash vs Points**
   - Tests decision logic for payment method
   - Verifies fallback when points unavailable

6. **Connection Choice**
   - Among multiple connections, picks best value
   - Considers both miles and value

7. **Insufficient Points**
   - Pays cash when not enough miles
   - Doesn't fail, finds alternative

8. **Complex Multi-City**
   - Tests round trips and cycles
   - Detects infeasibility correctly

#### Advanced Tests (test_ilp_advanced_optimality.py)

1. **Three Route Comparison**
   - Validates optimizer among 3+ competing routes
   - Verifies cpp calculations drive decisions

2. **Transfer Strategy Selection**
   - Multiple transfer paths available
   - Chooses most efficient (highest bonus)

3. **Multi-Traveler Cost Sharing**
   - One traveler can pay for others
   - Optimal allocation of payments

4. **Time vs Cost Tradeoff**
   - Balances time penalties with value
   - May choose faster or cheaper depending on weights

5. **Routing Logic**
   - Multiple travelers, multiple routes
   - All routed optimally

6. **Infeasibility Detection**
   - Correctly identifies impossible routes
   - Returns appropriate status

## Interpreting Specific Results

### Cents Per Point (CPP)

CPP = (Cash Cost - Surcharge) / Miles Used

**Good value**: > 1.5 cpp
**Excellent value**: > 2.0 cpp
**Outstanding value**: > 3.0 cpp

### Why Optimizer May Choose Unexpected Routes

The optimizer **maximizes total value saved**, not necessarily:
- ❌ Minimum miles
- ❌ Minimum time
- ❌ Minimum segments
- ✅ **Maximum cash value obtained from points**

**Example**: 
- Direct: 12,500 miles, saves $344 = 2.76 cpp
- Connection: 15,000 miles, saves $489 = 3.26 cpp
- **Chooses connection** (saves more money overall)

## Common Scenarios

### Test Shows "Used points despite poor value"

This is **expected behavior**. The optimizer will:
1. First maximize value from available award seats
2. Use remaining points if available
3. Fall back to cash only if insufficient points

### Test Shows "Chose cash over transfers"

This is **optimal** when:
- Transfer would use limited transferable points
- Cash cost is reasonable
- Points are more valuable for future use

### Status: Infeasible

Means **no valid route exists** with given constraints:
- No edges connecting start to end
- Insufficient capacity
- Points budget too low for any option
- Impossible meetup requirements

This is **correct behavior** - optimizer detects the problem.

## Manual Validation

To manually verify a solution:

```python
# From test output:
# Miles: 15000
# Cash: $11.20
# Value saved: $488.80

# Calculate CPP:
cpp = value_saved / miles_used
cpp = 488.80 / 15000
cpp = 0.0326 = 3.26 cents per point ✓

# Verify value calculation:
# For connection: NYC->ORD ($250) + ORD->LA ($250)
# Cash cost: $500
# Surcharges: $5.60 + $5.60 = $11.20
# Value = $500 - $11.20 = $488.80 ✓
```

## Debugging Failed Tests

### If a test fails:

1. **Check Status**
   - `Optimal` = Solution found
   - `Infeasible` = No valid route
   - `Undefined` = Solver error

2. **Examine Path**
   - Does it connect start to end?
   - Are all cities in the graph?

3. **Verify Calculations**
   - Manually compute cpp for chosen route
   - Compare to alternative routes
   - Check if constraints are violated

4. **Check Point Balances**
   - Are there enough points/cash?
   - Are transfer bonuses applied?

## Expected Behavior

### ✅ Normal/Expected

- Choosing connection over direct for better value
- Using cash when cpp is low (<1.5)
- Infeasible for impossible routes
- Transfer bonuses correctly applied (1.25x, 1.30x, etc.)

### ⚠ Investigate If You See

- Optimal status but empty path
- Negative value or cpp
- Wrong transfer ratios
- Violated balance constraints

## Performance Expectations

| Scenario | Expected Time |
|----------|--------------|
| Single traveler, 2-3 segments | < 200ms |
| Multi-traveler, meetup | < 500ms |
| Complex multi-city | < 1000ms |
| Large graph (20+ edges) | < 2000ms |

## Test Maintenance

### When to Update Tests

1. **Algorithm changes** - Update expected results
2. **New features** - Add corresponding tests
3. **Bug fixes** - Add regression test
4. **Objective changes** - Adjust value calculations

### Adding New Tests

```python
def test_my_scenario():
    """
    Test Case N: Description
    Optimal: Expected behavior
    """
    edges = { ... }
    travelers = [ ... ]
    # ... setup ...
    
    solution = run_ilp_from_edges(...)
    
    # Verify
    assert solution['status'] == 'Optimal'
    assert solution['path']['alice'] == expected_path
    # ... more assertions ...
```

## Contact & Support

For questions about test results or optimizer behavior:
1. Check this guide first
2. Review ILP_OPTIMALITY_TEST_REPORT.md
3. Examine the test code for detailed scenarios
4. Review planTrip.py for algorithm details

---

**Last Updated**: January 24, 2026
**Status**: All 14 tests passing ✅
