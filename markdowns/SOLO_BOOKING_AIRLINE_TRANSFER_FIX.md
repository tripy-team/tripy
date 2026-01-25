# Solo Booking Airline Transfer Fix

## Problem Summary

**Issue:** For solo bookings, only hotel programs were being suggested for points transfers. Credit card points (Chase, Amex, Citi, etc.) were NOT being transferred to airlines for flights, even though the system was designed to support this.

**User Impact:** Users with Chase Ultimate Rewards, Amex Membership Rewards, and other credit card points couldn't use them to book award flights. The booking page only showed generic hotel transfer suggestions.

## Root Cause

The bug was in `/backend/src/services/itinerary_service.py` at **line 1486-1487**:

```python
# OLD CODE (BROKEN):
program_lower = program.lower().strip()  
user_points_by_trav[user_id][program_lower] = balance
```

This code was converting program names like `"Chase Ultimate Rewards"` to `"chase ultimate rewards"` (full name, lowercased).

However, the **transfer_graph** expects SHORT CODES:
- Banks: `"chase"`, `"amex"`, `"citi"` (lowercase, single word)
- Airlines: `"UA"`, `"AA"`, `"DL"` (uppercase, 2-letter codes)

The ILP adapter's `_is_bank_key()` function checks if a key is:
1. Lowercase ✓
2. In the transfer_graph ✗ (`"chase ultimate rewards"` ≠ `"chase"`)

Since credit card programs weren't recognized as banks, they were treated as airline miles (which they're not), and therefore couldn't be transferred!

## The Fix

### 1. Created Program Normalization Function

Added `_normalize_program_to_transfer_key()` function in `itinerary_service.py` (after line 47):

```python
def _normalize_program_to_transfer_key(program: str) -> str:
    """
    Normalize program name to transfer graph key.
    Banks: "Chase Ultimate Rewards" -> "chase"
    Airlines: "United MileagePlus" -> "UA"
    Hotels: "Marriott Bonvoy" -> "MAR"
    """
    # Maps full names to short codes
    # - Chase Ultimate Rewards → chase
    # - Amex Membership Rewards → amex
    # - United MileagePlus → UA
    # - Delta SkyMiles → DL
    # etc.
```

### 2. Updated Points Loading Logic

Changed line 1486-1487 to use the normalization function:

```python
# NEW CODE (FIXED):
program_normalized = _normalize_program_to_transfer_key(program)
user_points_by_trav[user_id][program_normalized] = balance
```

## Supported Mappings

### Credit Card Programs (Banks)
- Chase Ultimate Rewards → `chase`
- Amex Membership Rewards → `amex`
- Citi ThankYou Points → `citi`
- Capital One Miles → `capitalone`
- Bilt Rewards → `bilt`

### Airline Programs
- United MileagePlus → `UA`
- Delta SkyMiles → `DL`
- American Airlines AAdvantage → `AA`
- JetBlue TrueBlue → `B6`
- Alaska Mileage Plan → `AS`
- British Airways Avios → `BA`
- Air France/KLM Flying Blue → `AF`
- Virgin Atlantic Flying Club → `VS`
- ...and 20+ more airlines

### Hotel Programs
- Marriott Bonvoy → `MAR`
- Hilton Honors → `HH`
- Hyatt World of Hyatt → `HYATT`
- IHG Rewards → `IHG`

## Testing

Created `test_program_normalization.py` to verify the fix:

```bash
cd backend
python test_program_normalization.py
```

Result: **ALL TESTS PASSED!**

## Impact

### Before Fix
✗ Solo bookings: Only hotel transfers shown
✗ Credit card points: Not recognized as banks
✗ Flight bookings: Paid with cash instead of points
✗ User confusion: "Why can't I use my Chase points for flights?"

### After Fix
✓ Solo bookings: **Airlines AND hotels** available for transfers
✓ Credit card points: Correctly recognized as transferable banks
✓ Flight bookings: Use credit card → airline point transfers
✓ Optimal value: Maximize cents-per-point for flights

## Files Modified

1. `/backend/src/services/itinerary_service.py`
   - Added `_normalize_program_to_transfer_key()` function (after line 47)
   - Updated points loading logic (line 1488)

2. `/backend/test_jfk_fll.py`
   - Fixed import errors (pathlib → os)

3. `/backend/test_program_normalization.py` (NEW)
   - Comprehensive test suite for normalization

## Next Steps

1. Deploy the fix to staging
2. Test with real user accounts that have credit card points
3. Verify booking page shows airline transfers (not just hotels)
4. Deploy to production

## Notes

- The fix is backwards compatible (short codes still work)
- Hotel programs also benefit from better normalization
- Airline miles (native balances) continue to work as before
- No database schema changes needed
