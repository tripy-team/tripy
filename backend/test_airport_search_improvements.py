#!/usr/bin/env python3
"""
Test script to verify airport search improvements.
Tests city names, IATA codes, nicknames, and partial matches.
"""
import sys
from pathlib import Path

# Add backend to path
backend_dir = Path(__file__).parent
sys.path.insert(0, str(backend_dir))

from src.services.airport_service import search_airports

def test_search(query: str, description: str):
    """Test a search query and display results"""
    print(f"\n{'='*80}")
    print(f"Test: {description}")
    print(f"Query: '{query}'")
    print(f"{'='*80}")
    
    try:
        results = search_airports(query, max_results=5)
        
        if not results:
            print("❌ No results found")
            return False
        
        print(f"✓ Found {len(results)} results:")
        for i, airport in enumerate(results, 1):
            iata = airport.get("iata_code", "N/A")
            name = airport.get("airport_name", "N/A")
            city = airport.get("city", "N/A")
            country = airport.get("country", "N/A")
            print(f"  {i}. {iata} - {name}")
            print(f"     {city}, {country}")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

def main():
    """Run all test cases"""
    print("\n" + "="*80)
    print("AIRPORT SEARCH SENSITIVITY TESTS")
    print("="*80)
    
    test_cases = [
        # City name queries
        ("New York", "Full city name"),
        ("Paris", "European city"),
        ("London", "Major international city"),
        ("San Francisco", "Multi-word city name"),
        
        # City nickname queries
        ("NYC", "Common city abbreviation"),
        ("LA", "Two-letter abbreviation"),
        ("SF", "City nickname"),
        ("DC", "Capital city abbreviation"),
        
        # IATA code queries
        ("JFK", "Major US airport code"),
        ("CDG", "Major European airport code"),
        ("LAX", "West coast hub code"),
        ("LHR", "London Heathrow code"),
        
        # Partial match queries
        ("San Fr", "Partial city name"),
        ("Lond", "Partial city name 2"),
        ("Seat", "Partial for Seattle"),
        
        # Edge cases
        ("ORD", "Chicago O'Hare"),
        ("DFW", "Dallas Fort Worth"),
        ("SFO", "San Francisco airport code"),
    ]
    
    passed = 0
    failed = 0
    
    for query, description in test_cases:
        if test_search(query, description):
            passed += 1
        else:
            failed += 1
    
    # Summary
    print(f"\n{'='*80}")
    print("TEST SUMMARY")
    print(f"{'='*80}")
    print(f"Total tests: {len(test_cases)}")
    print(f"✓ Passed: {passed}")
    if failed > 0:
        print(f"❌ Failed: {failed}")
    print(f"{'='*80}\n")
    
    return 0 if failed == 0 else 1

if __name__ == "__main__":
    sys.exit(main())
