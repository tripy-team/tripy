"""
Test trip planning from Fort Lauderdale to NYC
Trip: March 8-15, 2026 | FLL -> NYC -> FLL
"""

import sys
import json
import os

backend_path = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_path)

from src.handlers.planTrip import plan_trip


def test_fll_to_nyc():
    """
    Test planning a trip from Fort Lauderdale to New York City
    with 100k Chase Ultimate Rewards and $500 cash budget
    """
    
    trip_request = {
        "trip_details": {
            "start_date": "2026-03-08",
            "end_date": "2026-03-15",
            "origin_location": "Fort Lauderdale, FL",
            "return_location": "Fort Lauderdale, FL",
            "itinerary_request": [
                {
                    "location_query": "New York City, NYC"
                }
            ],
            "travelers": 1
        },
        
        "budget_preferences": {
            "cash_limit": 500,
            "currency": "USD",
            "flexibility": "strict" 
        },

        "loyalty_wallet": {
            "chase_ultimate_rewards": 100000
        }
    }
    
    print("=" * 80)
    print("TRIP REQUEST")
    print("=" * 80)
    print(json.dumps(trip_request, indent=2))
    print("\n")
    
    try:
        result = plan_trip(trip_request)
        
        print("=" * 80)
        print("TRIP PLANNING RESULT")
        print("=" * 80)
        print(json.dumps(result, indent=2, default=str))
        
    except Exception as e:
        print(f"Error planning trip: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_fll_to_nyc()
