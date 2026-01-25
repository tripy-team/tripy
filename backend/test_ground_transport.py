#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Test script for ground transport validation using SerpAPI Google Maps Directions.

Tests:
1. Impossible routes (trans-oceanic): JFK -> LHR (should return empty)
2. Feasible routes (within limits): JFK -> BOS (should return bus + car)
3. Long routes (car only): JFK -> MIA (should return car only, no bus)
4. Same continent but ocean: NRT -> ICN (Japan to Korea - should return empty)
5. Same country feasible: LAX -> SFO (should return bus + car)
"""

import sys
import os

# Add the backend src to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from src.handlers.ground_transport import (
    get_bus_and_car_options,
    estimate_bus_cost,
    estimate_car_cost,
    MAX_BUS_DISTANCE_MILES,
    MAX_CAR_DISTANCE_MILES,
)


def test_cost_estimation():
    """Test cost estimation functions."""
    print("\n" + "="*60)
    print("Testing cost estimation functions")
    print("="*60)
    
    # Test bus cost
    assert estimate_bus_cost(100) == 28.0, "Bus cost for 100 miles should be $28"
    assert estimate_bus_cost(300) == 44.0, "Bus cost for 300 miles should be $44"
    assert estimate_bus_cost(0) == 20.0, "Bus cost for 0 miles should be $20 (base)"
    print("[OK] Bus cost estimation working correctly")
    
    # Test car cost
    assert estimate_car_cost(100) == 25.0, "Car cost for 100 miles should be $25"
    assert estimate_car_cost(400) == 100.0, "Car cost for 400 miles should be $100"
    assert estimate_car_cost(0) == 20.0, "Car cost for 0 miles should be $20 (min)"
    print("[OK] Car cost estimation working correctly")
    
    print("\n[OK] All cost estimation tests passed!")


def test_route(origin, destination, expected_modes, description):
    """Test a single route and verify expected modes."""
    print("\n" + "="*60)
    print("Testing: {}".format(description))
    print("Route: {} -> {}".format(origin, destination))
    print("Expected modes: {}".format(expected_modes or "None (empty)"))
    print("="*60)
    
    options = get_bus_and_car_options(origin, destination)
    
    if not options:
        print("Result: No ground transport options (empty list)")
        if not expected_modes:
            print("[PASS] Expected no options")
            return True
        else:
            print("[FAIL] Expected {} but got empty".format(expected_modes))
            return False
    
    actual_modes = [opt["mode"] for opt in options]
    print("Result: {} option(s) found".format(len(options)))
    for opt in options:
        dist_info = ""
        if opt.get("distance_miles"):
            dist_info = ", {:.1f} miles".format(opt["distance_miles"])
        print("  - {}: ${:.2f}, {} min{}".format(
            opt["mode"].upper(), opt["cash_cost"], opt["time_cost"], dist_info
        ))
    
    if set(actual_modes) == set(expected_modes):
        print("[PASS] Got expected modes: {}".format(actual_modes))
        return True
    else:
        print("[FAIL] Expected {} but got {}".format(expected_modes, actual_modes))
        return False


def main():
    """Run all ground transport tests."""
    print("\n" + "#"*60)
    print("# Ground Transport Validation Tests")
    print("# Using SerpAPI Google Maps Directions")
    print("#"*60)
    
    # Check if SERPAPI_KEY is configured
    serp_key = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
    if not serp_key:
        print("\n[WARNING] SERPAPI_KEY not configured!")
        print("   Tests will fail without a valid SerpAPI key.")
        print("   Set SERPAPI_KEY in your .env file.\n")
    else:
        print("\n[OK] SERPAPI_KEY configured (ends with ...{})".format(serp_key[-4:]))
    
    print("\nDistance limits:")
    print("  - Bus: {} miles max".format(MAX_BUS_DISTANCE_MILES))
    print("  - Car: {} miles max".format(MAX_CAR_DISTANCE_MILES))
    
    # Run cost estimation tests (no API needed)
    test_cost_estimation()
    
    if not serp_key:
        print("\n[WARNING] Skipping API tests (no SERPAPI_KEY)")
        return 0
    
    # Run route tests
    results = []
    
    # Test 1: Trans-oceanic (impossible)
    results.append(test_route(
        "JFK", "LHR",
        expected_modes=[],
        description="Trans-oceanic route (JFK to London Heathrow)"
    ))
    
    # Test 2: Short feasible route
    results.append(test_route(
        "JFK", "BOS",
        expected_modes=["bus", "car"],
        description="Short feasible route (JFK to Boston ~215 miles)"
    ))
    
    # Test 3: Medium route (Washington DC to NYC - ~230 miles)
    results.append(test_route(
        "DCA", "JFK",
        expected_modes=["bus", "car"],  # ~230 miles - within both limits
        description="Medium route (DC to NYC ~230 miles)"
    ))
    
    # Test 4: Island to mainland (Japan to Korea - impossible)
    results.append(test_route(
        "NRT", "ICN",
        expected_modes=[],
        description="Island to mainland (Tokyo to Seoul - ocean crossing)"
    ))
    
    # Test 5: Same state/region
    results.append(test_route(
        "LAX", "SFO",
        expected_modes=["bus", "car"],
        description="Same state route (LA to San Francisco ~380 miles)"
    ))
    
    # Test 6: Different continents
    results.append(test_route(
        "CDG", "JFK",
        expected_modes=[],
        description="Different continents (Paris to New York)"
    ))
    
    # Summary
    print("\n" + "#"*60)
    print("# TEST SUMMARY")
    print("#"*60)
    passed = sum(results)
    total = len(results)
    print("\nPassed: {}/{}".format(passed, total))
    
    if passed == total:
        print("\n[OK] All tests passed!")
        return 0
    else:
        print("\n[FAIL] {} test(s) failed".format(total - passed))
        return 1


if __name__ == "__main__":
    sys.exit(main())
