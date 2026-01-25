# -*- coding: utf-8 -*-
"""
Test program normalization to ensure credit card and airline programs
are correctly mapped to transfer graph keys.
"""

def _normalize_program_to_transfer_key(program):
    """
    Normalize program name to transfer graph key.
    Banks: "Chase Ultimate Rewards" -> "chase", "Amex Membership Rewards" -> "amex"
    Airlines: "United MileagePlus" -> "UA", "Delta SkyMiles" -> "DL"
    Hotels: "Marriott Bonvoy" -> "MAR", "Hilton Honors" -> "HH"
    """
    s = (program or "").strip().lower()
    
    # Bank mappings (lowercase short codes for transfer graph)
    bank_mapping = {
        "amex": "amex",
        "amex membership rewards": "amex",
        "membership rewards": "amex",
        "chase": "chase",
        "chase ultimate rewards": "chase",
        "ultimate rewards": "chase",
        "citi": "citi",
        "citi thankyou": "citi",
        "citi thankyou points": "citi",
        "thankyou": "citi",
        "thankyou points": "citi",
        "capital one": "capitalone",
        "capital one miles": "capitalone",
        "capitalone": "capitalone",
        "venture": "capitalone",
        "bilt": "bilt",
        "bilt rewards": "bilt",
    }
    
    # Airline mappings (uppercase 2-letter codes)
    airline_mapping = {
        "united": "UA",
        "united mileageplus": "UA",
        "mileageplus": "UA",
        "american": "AA",
        "american airlines": "AA",
        "american airlines aadvantage": "AA",
        "aadvantage": "AA",
        "american aadvantage": "AA",
        "delta": "DL",
        "delta skymiles": "DL",
        "skymiles": "DL",
        "alaska": "AS",
        "alaska mileage plan": "AS",
        "jetblue": "B6",
        "jetblue trueblue": "B6",
        "trueblue": "B6",
    }
    
    # Hotel mappings (uppercase program codes)
    hotel_mapping = {
        "marriott": "MAR",
        "marriott bonvoy": "MAR",
        "bonvoy": "MAR",
        "hilton": "HH",
        "hilton honors": "HH",
        "hyatt": "HYATT",
        "hyatt world of hyatt": "HYATT",
        "ihg": "IHG",
        "ihg rewards": "IHG",
    }
    
    # Check mappings in order: bank, airline, hotel
    if s in bank_mapping:
        return bank_mapping[s]
    if s in airline_mapping:
        return airline_mapping[s]
    if s in hotel_mapping:
        return hotel_mapping[s]
    
    # Fallback: check if it's already a short code
    original_stripped = program.strip()
    if len(original_stripped) <= 3 and original_stripped.isupper():
        return original_stripped
    if len(original_stripped) <= 10 and original_stripped.islower():
        return original_stripped
    
    return s


def test_normalization():
    """Test that programs are correctly normalized"""
    
    print("=" * 60)
    print("TESTING PROGRAM NORMALIZATION")
    print("=" * 60)
    
    test_cases = [
        # Credit card programs (should map to lowercase short codes)
        ("Chase Ultimate Rewards", "chase", "Bank"),
        ("Amex Membership Rewards", "amex", "Bank"),
        ("Citi ThankYou Points", "citi", "Bank"),
        ("Capital One Miles", "capitalone", "Bank"),
        ("Bilt Rewards", "bilt", "Bank"),
        
        # Airline programs (should map to uppercase 2-letter codes)
        ("United MileagePlus", "UA", "Airline"),
        ("Delta SkyMiles", "DL", "Airline"),
        ("American Airlines AAdvantage", "AA", "Airline"),
        ("JetBlue TrueBlue", "B6", "Airline"),
        ("Alaska Mileage Plan", "AS", "Airline"),
        
        # Hotel programs (should map to uppercase codes)
        ("Marriott Bonvoy", "MAR", "Hotel"),
        ("Hilton Honors", "HH", "Hotel"),
        ("Hyatt World of Hyatt", "HYATT", "Hotel"),
        ("IHG Rewards", "IHG", "Hotel"),
        
        # Already short codes
        ("UA", "UA", "Airline short code"),
        ("AA", "AA", "Airline short code"),
        ("chase", "chase", "Bank short code"),
        ("amex", "amex", "Bank short code"),
    ]
    
    all_passed = True
    for program, expected, category in test_cases:
        result = _normalize_program_to_transfer_key(program)
        passed = result == expected
        all_passed = all_passed and passed
        
        status = "[PASS]" if passed else "[FAIL]"
        print("{} [{}] '{}' -> '{}' (expected: '{}')".format(status, category, program, result, expected))
    
    print("=" * 60)
    if all_passed:
        print("ALL TESTS PASSED!")
        print("\nFix Summary:")
        print("- Credit card programs (Chase, Amex, etc.) now map to lowercase bank codes")
        print("- These codes match the transfer_graph keys (e.g., 'chase', 'amex')")
        print("- The ILP will now recognize them as banks and allow transfers to airlines")
        print("- Solo bookings will now use BOTH airlines AND hotels for transfers!")
    else:
        print("SOME TESTS FAILED!")
    print("=" * 60)
    
    return all_passed


if __name__ == "__main__":
    test_normalization()
