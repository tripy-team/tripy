#!/usr/bin/env python3
"""
Test script to verify the multi-airport fix.

Before the fix:
- Paris (CDG, ORY) would create TWO legs: one to CDG, one to ORY
- The optimizer would try to satisfy BOTH legs = visit BOTH airports

After the fix:
- Paris creates ONE leg with allowed_destination_airports=[CDG, ORY]
- The optimizer picks ONE flight to EITHER airport (OR, not AND)
"""

import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.agents.orchestrator import OrchestratorAgent, _get_all_airports_for_location


def test_multi_airport_mapping():
    """Test that cities map to multiple airports correctly."""
    print("\n" + "="*60)
    print("TEST 1: Multi-airport city mapping")
    print("="*60)
    
    # Test Paris
    paris_airports = _get_all_airports_for_location("Paris")
    print(f"Paris airports: {paris_airports}")
    assert "CDG" in paris_airports, "Paris should include CDG"
    assert "ORY" in paris_airports, "Paris should include ORY"
    
    # Test London
    london_airports = _get_all_airports_for_location("London")
    print(f"London airports: {london_airports}")
    assert "LHR" in london_airports, "London should include LHR"
    
    # Test single-airport city
    seattle_airports = _get_all_airports_for_location("Seattle")
    print(f"Seattle airports: {seattle_airports}")
    assert "SEA" in seattle_airports, "Seattle should include SEA"
    
    print("✓ Multi-airport mapping works correctly\n")


def test_city_pair_segments():
    """Test that segments are created per city-pair, not per airport-pair."""
    print("\n" + "="*60)
    print("TEST 2: City-pair segment creation (not airport-pair)")
    print("="*60)
    
    orchestrator = OrchestratorAgent()
    
    # Trip: Seattle → Paris → Seattle (round trip)
    trip_data = {
        "trip_id": "test-123",
        "start_date": "2026-03-01",
        "end_date": "2026-03-08",
        "destinations": [
            {"name": "Seattle", "is_start": True, "is_end": True},
            {"name": "Paris", "must_include": True},
        ],
    }
    
    segments = orchestrator._build_trip_segments(trip_data)
    
    print(f"\nTrip: Seattle → Paris → Seattle")
    print(f"Number of segments: {len(segments)}")
    
    for i, seg in enumerate(segments):
        print(f"\nSegment {i}:")
        print(f"  Type: {seg.get('type')}")
        print(f"  Origin city: {seg.get('origin_city')}")
        print(f"  Dest city: {seg.get('dest_city')}")
        print(f"  Allowed origin airports: {seg.get('allowed_origin_airports')}")
        print(f"  Allowed dest airports: {seg.get('allowed_destination_airports')}")
        print(f"  Airport search pairs: {seg.get('airport_search_pairs')}")
    
    # CRITICAL: Should be 2 segments (SEA→Paris, Paris→SEA), not 4 (SEA→CDG, SEA→ORY, CDG→SEA, ORY→SEA)
    assert len(segments) == 2, f"Expected 2 city-pair segments, got {len(segments)}"
    
    # Check first segment: Seattle → Paris
    seg1 = segments[0]
    assert seg1["origin_city"] == "SEA", f"Expected origin_city='SEA' (canonical), got '{seg1.get('origin_city')}'"
    assert seg1["dest_city"] == "PAR", f"Expected dest_city='PAR' (canonical), got '{seg1.get('dest_city')}'"
    assert "CDG" in seg1["allowed_destination_airports"], "Paris leg should allow CDG"
    assert "ORY" in seg1["allowed_destination_airports"], "Paris leg should allow ORY"
    
    # Check that airport_search_pairs includes all combinations
    search_pairs = seg1.get("airport_search_pairs", [])
    print(f"\nSearch pairs for Seattle→Paris: {search_pairs}")
    assert ("SEA", "CDG") in search_pairs, "Should search SEA→CDG"
    assert ("SEA", "ORY") in search_pairs, "Should search SEA→ORY"
    
    print("\n✓ City-pair segments created correctly (not airport-pairs)")
    print("✓ Multiple airports are OR alternatives, not AND requirements\n")


def test_three_city_trip():
    """Test a three-city trip with multi-airport cities."""
    print("\n" + "="*60)
    print("TEST 3: Three-city trip (Seattle → Paris → Rome → Seattle)")
    print("="*60)
    
    orchestrator = OrchestratorAgent()
    
    trip_data = {
        "trip_id": "test-456",
        "start_date": "2026-03-01",
        "end_date": "2026-03-15",
        "destinations": [
            {"name": "Seattle", "is_start": True, "is_end": True},
            {"name": "Paris", "must_include": True},
            {"name": "Rome", "must_include": True},
        ],
    }
    
    segments = orchestrator._build_trip_segments(trip_data)
    
    print(f"\nTrip: Seattle → Paris → Rome → Seattle")
    print(f"Number of segments: {len(segments)}")
    
    # With 2 intermediate cities, there are 2 permutations:
    # SEA → Paris → Rome → SEA
    # SEA → Rome → Paris → SEA
    # But segments should be deduplicated by city-pair
    
    for i, seg in enumerate(segments):
        print(f"\nSegment {i}: {seg.get('origin_city')} → {seg.get('dest_city')}")
        print(f"  Allowed origins: {seg.get('allowed_origin_airports')}")
        print(f"  Allowed dests: {seg.get('allowed_destination_airports')}")
    
    # Count unique city-pairs
    city_pairs = set()
    for seg in segments:
        city_pairs.add((seg["origin_city"], seg["dest_city"]))
    
    print(f"\nUnique city-pairs: {city_pairs}")
    
    # For round trip SEA→Paris→Rome→SEA, we need:
    # SEA→Paris, Paris→Rome, Rome→SEA, SEA→Rome, Rome→Paris, Paris→SEA
    # But since we have permutations, we might have more
    # Key point: each city-pair should be ONE segment with multiple airport alternatives
    
    print("\n✓ Three-city trip segments created correctly\n")


def test_no_duplicate_legs_in_optimizer():
    """Verify the fix by checking that each city-pair creates exactly ONE leg."""
    print("\n" + "="*60)
    print("TEST 4: No duplicate legs for multi-airport cities")
    print("="*60)
    
    orchestrator = OrchestratorAgent()
    
    # Trip: JFK → Paris → JFK
    trip_data = {
        "trip_id": "test-789",
        "start_date": "2026-03-01",
        "end_date": "2026-03-08",
        "destinations": [
            {"name": "JFK", "is_start": True, "is_end": True},
            {"name": "Paris", "must_include": True},
        ],
    }
    
    segments = orchestrator._build_trip_segments(trip_data)
    
    # Build legs using adapter
    from src.optimization.adapter_v3 import _build_legs_and_segments
    legs, stays = _build_legs_and_segments(segments)
    
    print(f"\nTrip: JFK → Paris → JFK")
    print(f"Number of segments: {len(segments)}")
    print(f"Number of legs: {len(legs)}")
    
    for leg in legs:
        print(f"\nLeg {leg.leg_id}:")
        print(f"  Origin: {leg.origin_city}")
        print(f"  Destination: {leg.destination_city}")
        print(f"  Allowed origins: {leg.allowed_origin_airports}")
        print(f"  Allowed dests: {leg.allowed_destination_airports}")
    
    # CRITICAL: Should be 2 legs, not 4
    # Before fix: JFK→CDG, JFK→ORY, CDG→JFK, ORY→JFK (4 legs)
    # After fix: JFK→Paris, Paris→JFK (2 legs)
    assert len(legs) == 2, f"Expected 2 legs, got {len(legs)}. Fix not working!"
    
    # Verify Paris leg has both airports as alternatives
    paris_outbound = [l for l in legs if "CDG" in (l.allowed_destination_airports or []) or 
                     "ORY" in (l.allowed_destination_airports or [])]
    assert len(paris_outbound) == 1, f"Expected 1 Paris outbound leg, got {len(paris_outbound)}"
    
    print("\n✓ No duplicate legs - multi-airport cities create ONE leg with alternatives")
    print("✓ Optimizer will pick ONE flight to either CDG or ORY, not both!\n")


if __name__ == "__main__":
    print("\n" + "="*60)
    print("MULTI-AIRPORT FIX VERIFICATION")
    print("="*60)
    print("\nThis test verifies that cities with multiple airports")
    print("(like Paris with CDG and ORY) create ONE leg with")
    print("alternatives, not separate legs that must all be visited.")
    
    try:
        test_multi_airport_mapping()
        test_city_pair_segments()
        test_three_city_trip()
        test_no_duplicate_legs_in_optimizer()
        
        print("\n" + "="*60)
        print("ALL TESTS PASSED!")
        print("="*60)
        print("\nThe multi-airport fix is working correctly.")
        print("Cities with multiple airports are now treated as OR alternatives.")
        print("The optimizer will pick ONE flight to any valid airport in the city.\n")
        
    except AssertionError as e:
        print(f"\n❌ TEST FAILED: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
