"""
Diagnostic test to debug why flights aren't being found for itineraries.

This test helps identify:
1. Whether AwardTool API is working
2. Whether SerpAPI is working
3. If the trip has proper start/end destinations
4. If the dates are valid for the APIs

Run with: python test_flight_search_debug.py
"""

import sys
import os
import asyncio
from pathlib import Path
from datetime import datetime, timedelta

# Add the backend src to path
backend_path = Path(__file__).parent
sys.path.insert(0, str(backend_path))

from dotenv import load_dotenv
load_dotenv()


def print_section(title: str):
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


async def test_api_keys():
    """Check if API keys are configured."""
    print_section("1. API KEY CHECK")
    
    award_key = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
    serp_key = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
    
    print(f"  AWARD_TOOL_API_KEY: {'✓ Set' if award_key else '✗ NOT SET'}")
    print(f"  SERPAPI_KEY: {'✓ Set' if serp_key else '✗ NOT SET'}")
    
    if not award_key:
        print("\n  ⚠️  AwardTool API key is missing!")
        print("      Set AWARD_TOOL_API_KEY in your .env file")
    
    if not serp_key:
        print("\n  ⚠️  SerpAPI key is missing!")
        print("      Set SERPAPI_KEY in your .env file")
    
    return bool(award_key), bool(serp_key)


async def test_flight_search(origin: str, destination: str, date: str):
    """Test flight search between two airports."""
    print_section(f"2. FLIGHT SEARCH: {origin} → {destination} on {date}")
    
    from src.handlers.flights import (
        get_flights_award_first_with_points_async,
        get_flights_serp_first_with_points_async,
        get_flights_serp_only,
    )
    
    # Test user points (common programs)
    test_points = {
        "amex": 100000,
        "chase": 100000,
        "UA": 50000,
        "AA": 50000,
        "DL": 50000,
    }
    
    filters = {
        "outbound_date": date,
        "pax": 1,
        "travel_class": "economy",
    }
    
    print(f"\n  Testing with date: {date}")
    print(f"  Points: {test_points}")
    
    # Test Award-first
    print("\n  --- AwardTool + SERP (Award First) ---")
    try:
        edges_award = await get_flights_award_first_with_points_async(
            origin, destination, test_points, filters
        )
        if edges_award:
            print(f"  ✓ Found {len(edges_award)} flight edges!")
            for i, (key, data) in enumerate(list(edges_award.items())[:3]):
                print(f"    {i+1}. {key[0]} → {key[1]} ({key[2]})")
                print(f"       Cash: ${data.get('cash_cost', 'N/A')}, Points: {data.get('award_points', 'N/A')}")
        else:
            print("  ✗ No edges found via AwardTool")
    except Exception as e:
        print(f"  ✗ Error: {e}")
    
    # Test SERP-first
    print("\n  --- SERP + AwardTool (SERP First) ---")
    try:
        edges_serp = await get_flights_serp_first_with_points_async(
            origin, destination, test_points, filters
        )
        if edges_serp:
            print(f"  ✓ Found {len(edges_serp)} flight edges!")
            for i, (key, data) in enumerate(list(edges_serp.items())[:3]):
                print(f"    {i+1}. {key[0]} → {key[1]} ({key[2]})")
                print(f"       Cash: ${data.get('cash_cost', 'N/A')}, Points: {data.get('award_points', 'N/A')}")
        else:
            print("  ✗ No edges found via SERP-first")
    except Exception as e:
        print(f"  ✗ Error: {e}")
    
    # Test SERP-only
    print("\n  --- SERP Only (Cash flights) ---")
    try:
        edges_serp_only = get_flights_serp_only(origin, destination, date, filters)
        if edges_serp_only:
            print(f"  ✓ Found {len(edges_serp_only)} flight edges!")
            for i, (key, data) in enumerate(list(edges_serp_only.items())[:3]):
                print(f"    {i+1}. {key[0]} → {key[1]} ({key[2]})")
                print(f"       Cash: ${data.get('cash_cost', 'N/A')}")
        else:
            print("  ✗ No edges found via SERP-only")
    except Exception as e:
        print(f"  ✗ Error: {e}")
    
    return bool(edges_award or edges_serp or edges_serp_only)


async def test_trip_itinerary(trip_id: str):
    """Test generating itinerary for an existing trip."""
    print_section(f"3. TRIP ANALYSIS: {trip_id}")
    
    from src.services import trip_service, destination_service, points_service
    from src.repos import trip_repo
    
    # Get trip
    trip = trip_repo.get_trip(trip_id)
    if not trip:
        print(f"  ✗ Trip {trip_id} not found!")
        return False
    
    print(f"\n  Trip: {trip.get('title', 'Untitled')}")
    print(f"  Start Date: {trip.get('startDate', 'N/A')}")
    print(f"  End Date: {trip.get('endDate', 'N/A')}")
    print(f"  Include Hotels: {trip.get('includeHotels', True)}")
    print(f"  Max Budget: ${trip.get('maxBudget', 'Unlimited')}")
    
    # Get destinations
    destinations = destination_service.list_destinations(trip_id) or []
    print(f"\n  Destinations ({len(destinations)}):")
    
    start_dest = None
    end_dest = None
    other_dests = []
    
    for d in destinations:
        name = d.get('name', 'Unknown')
        is_start = d.get('isStart', False)
        is_end = d.get('isEnd', False)
        must_include = d.get('mustInclude', False)
        
        flags = []
        if is_start:
            flags.append("START")
            start_dest = d
        if is_end:
            flags.append("END")
            end_dest = d
        if must_include:
            flags.append("must_include")
        
        flag_str = f" [{', '.join(flags)}]" if flags else ""
        print(f"    - {name}{flag_str}")
        
        if not is_start and not is_end:
            other_dests.append(d)
    
    # Check for issues
    issues = []
    
    if not start_dest:
        issues.append("⚠️  No START destination set! The system doesn't know where you're flying FROM.")
    
    if not end_dest:
        issues.append("⚠️  No END destination set! The system doesn't know your final destination.")
    
    if start_dest and end_dest:
        start_name = start_dest.get('name', '')
        end_name = end_dest.get('name', '')
        if start_name == end_name:
            issues.append(f"⚠️  START and END are the same ({start_name})! This is a round trip, but you need at least one destination city in between.")
    
    if not other_dests and start_dest and end_dest:
        start_name = start_dest.get('name', '')
        end_name = end_dest.get('name', '')
        if start_name != end_name:
            print(f"\n  Route: {start_name} → {end_name} (one-way)")
        else:
            issues.append("⚠️  No destination cities to visit! Add at least one city you want to travel to.")
    
    if issues:
        print("\n  ISSUES FOUND:")
        for issue in issues:
            print(f"    {issue}")
    else:
        print("\n  ✓ Trip configuration looks correct!")
    
    # Get points
    points = points_service.list_points_for_trip(trip_id) or []
    print(f"\n  Points Programs ({len(points)}):")
    for p in points:
        print(f"    - {p.get('program', 'Unknown')}: {p.get('balance', 0):,} pts")
    
    return len(issues) == 0


async def main():
    print("\n" + "=" * 60)
    print("  FLIGHT SEARCH DIAGNOSTIC")
    print("=" * 60)
    
    # 1. Check API keys
    has_award_key, has_serp_key = await test_api_keys()
    
    if not has_award_key and not has_serp_key:
        print("\n❌ Neither API key is set. Cannot search for flights!")
        print("   Please configure at least one of:")
        print("   - AWARD_TOOL_API_KEY (for award flights)")
        print("   - SERPAPI_KEY (for cash flights)")
        return
    
    # 2. Test common routes
    # Use a date 2-3 months in the future for better availability
    future_date = (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d")
    
    test_routes = [
        ("JFK", "ICN", future_date),  # NYC to Seoul
        ("LAX", "ICN", future_date),  # LA to Seoul
        ("JFK", "CDG", future_date),  # NYC to Paris
    ]
    
    print_section("TESTING COMMON ROUTES")
    
    for origin, dest, date in test_routes:
        try:
            success = await test_flight_search(origin, dest, date)
            if success:
                print(f"\n  ✓ Route {origin} → {dest} works!")
            else:
                print(f"\n  ✗ Route {origin} → {dest} returned no flights")
        except Exception as e:
            print(f"\n  ✗ Route {origin} → {dest} failed: {e}")
    
    # 3. Ask user if they want to test a specific trip
    print_section("TEST A SPECIFIC TRIP")
    print("  To test a specific trip, run:")
    print("  python -c \"import asyncio; from test_flight_search_debug import test_trip_itinerary; asyncio.run(test_trip_itinerary('YOUR_TRIP_ID'))\"")
    
    print("\n" + "=" * 60)
    print("  DIAGNOSTIC COMPLETE")
    print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
