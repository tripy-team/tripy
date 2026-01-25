"""
Test trip planning from Fort Lauderdale to NYC
Trip: March 8-15, 2026 | FLL -> NYC -> FLL
"""

import sys
import json
import os
import asyncio
import logging

# Set up logging to see AwardTool API calls
logging.basicConfig(level=logging.INFO, format='%(levelname)s - %(name)s - %(message)s')

backend_path = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, backend_path)

# Load environment variables from .env file BEFORE importing handlers
from dotenv import load_dotenv
env_path = os.path.join(backend_path, '.env')
load_dotenv(env_path)

from src.handlers.flights import get_flights_award_first_with_points_async
from src.handlers.ilp_adapter import run_ilp_from_edges
from src.handlers.planTrip import plan_non_pooled_multi_itineraries_with_native
from src.utils.award_programs import DEFAULT_TRANSFER_GRAPH

# Check what the flights module actually sees
from src.handlers import flights as flights_module
print(f"flights.py module sees AWARD_TOOL_API_KEY: {flights_module.AWARD_TOOL_API_KEY is not None}")
if flights_module.AWARD_TOOL_API_KEY:
    print(f"  Key value: {flights_module.AWARD_TOOL_API_KEY[:8]}...")
print()


async def test_fll_to_nyc():
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
        # Extract parameters
        start_date = trip_request["trip_details"]["start_date"]
        end_date = trip_request["trip_details"]["end_date"]
        travelers = ["traveler1"]  # Single traveler
        
        # Map locations to airport codes
        # FLL = Fort Lauderdale, JFK/LGA/EWR = NYC area airports
        start_city = {"traveler1": "FLL"}
        end_city = {"traveler1": "FLL"}  # Round trip back to FLL
        
        # Convert loyalty wallet to points format
        # Chase can transfer to multiple airlines including JetBlue (B6)
        user_points = {
            "traveler1": {
                "chase": trip_request["loyalty_wallet"]["chase_ultimate_rewards"],
                # Add small balances to test various programs
                "B6": 0,  # JetBlue
                "DL": 0,  # Delta
                "AA": 0,  # American
                "UA": 0,  # United
            }
        }
        
        # Define transfer options for Chase Ultimate Rewards
        transfer_graph_custom = {
            "chase": {
                "B6": 1.0,   # JetBlue 1:1
                "UA": 1.0,   # United 1:1
                "BA": 1.0,   # British Airways 1:1
                "AF": 1.0,   # Air France/Flying Blue 1:1
                "VS": 1.0,   # Virgin Atlantic 1:1
                "SQ": 1.0,   # Singapore Airlines 1:1
                "CX": 1.0,   # Cathay Pacific 1:1
            }
        }
        
        print(f"\n💳 Points available: {user_points['traveler1']['chase']:,} Chase Ultimate Rewards")
        print("   Can transfer to: JetBlue, United, British Airways, and more at 1:1")
        print()
        
        # Flight search filters - include award programs to search for award availability
        # IMPORTANT: Query only JetBlue to avoid AwardTool API timeout  
        # User has Chase UR which transfers to JetBlue at 1:1
        # Querying multiple programs causes timeout, so we focus on JetBlue
        
        filters_outbound = {
            "outbound_date": start_date,
            "travel_class": "economy",
            "bags": 1,
            "pax": 1,
            "award_programs": ["B6"],  # JetBlue only to avoid timeout
        }
        
        filters_return = {
            "outbound_date": end_date,
            "travel_class": "economy",
            "bags": 1,
            "pax": 1,
            "award_programs": ["B6"],  # JetBlue only to avoid timeout
        }
        
        print("=" * 80)
        print("FETCHING FLIGHT OPTIONS")
        print("=" * 80)
        
        # Check for API keys
        import os
        award_key = os.getenv('AWARD_TOOL_API_KEY')
        serp_key = os.getenv('SERP_API_KEY')
        print(f"API Keys configured:")
        print(f"  AWARD_TOOL_API_KEY: {'✅ Set' if award_key else '❌ Not set (award search will fail)'}")
        print(f"  SERP_API_KEY: {'✅ Set' if serp_key else '❌ Not set (cash search will fail)'}")
        print()
        
        print(f"Route 1: FLL -> JFK (Outbound on {start_date})")
        print(f"Route 2: JFK -> FLL (Return on {end_date})")
        print("\n")
        
        # Fetch flight options
        edges_all = {}
        
        # FLL to NYC (try JFK as primary NYC airport)
        print("Searching FLL -> JFK...")
        try:
            edges_outbound = await get_flights_award_first_with_points_async(
                "FLL", "JFK", user_points["traveler1"], filters_outbound
            )
            edges_all.update(edges_outbound)
            print(f"  Found {len(edges_outbound)} outbound options")
        except Exception as e:
            print(f"  Error fetching outbound flights: {type(e).__name__}: {e}")
            import traceback
            traceback.print_exc()
        
        # Return: JFK to FLL
        print("Searching JFK -> FLL...")
        try:
            edges_return = await get_flights_award_first_with_points_async(
                "JFK", "FLL", user_points["traveler1"], filters_return
            )
            edges_all.update(edges_return)
            print(f"  Found {len(edges_return)} return options")
        except Exception as e:
            print(f"  Error fetching return flights: {e}")
        
        print(f"\nFound {len(edges_all)} flight options total\n")
        
        # Save edges_all for inspection
        with open('edges_all_debug.json', 'w') as f:
            edges_serializable = {}
            for k, v in edges_all.items():
                key_str = f"{k[0]}->{k[1]} ({k[2] if len(k) > 2 else ''})"
                edges_serializable[key_str] = v
            json.dump(edges_serializable, f, indent=2, default=str)
        print(f"Saved edges_all to edges_all_debug.json\n")
        
        # DEBUG: Check if awards are in edges_all
        print("DEBUG: Checking for award data in edges...")
        
        # Check for all awards
        all_awards = [(k, v) for k, v in edges_all.items() if v.get('points_cost')]
        print(f"  Total awards in edges_all: {len(all_awards)}")
        
        # Show first 10 awards
        for i, (key, val) in enumerate(all_awards[:10]):
            origin, dest, flight = key[0], key[1], key[2] if len(key) > 2 else ''
            prog = val.get('points_program', '?')
            pts = val.get('points_cost', 0)
            print(f"  {i+1}. {origin}->{dest} ({flight}): {pts} {prog} pts")
        
        # Check specifically for JetBlue to JFK
        jetblue_to_jfk = [(k, v) for k, v in edges_all.items() if v.get('points_cost') and k[1] == 'JFK' and v.get('points_program') == 'B6']
        print(f"\n  JetBlue awards to JFK: {len(jetblue_to_jfk)}")
        
        # Check for ANY awards to JFK
        any_to_jfk = [(k, v) for k, v in edges_all.items() if v.get('points_cost') and k[1] == 'JFK']
        print(f"  Any awards to JFK: {len(any_to_jfk)}")
        if any_to_jfk:
            for k, v in any_to_jfk[:3]:
                print(f"    {k[0]}->{k[1]} ({k[2] if len(k) > 2 else '?'}): {v.get('points_cost')} {v.get('points_program')} pts")
        
        # Show sample of edges found WITH DETAILED AWARD INFO
        print("\nSample of flight edges found:")
        award_count = 0
        for i, (edge_key, edge_data) in enumerate(list(edges_all.items())[:10]):
            origin, dest = edge_key[0], edge_key[1]
            flight = edge_key[2] if len(edge_key) > 2 else 'N/A'
            cash = edge_data.get('cash_cost', 0)
            points = edge_data.get('points_cost')
            program = edge_data.get('points_program', 'N/A')
            surcharge = edge_data.get('points_surcharge', 0)
            
            if points is not None:
                award_count += 1
                cash_str = f"${cash:.2f}" if cash else "N/A"
                print(f"  ✈️ {origin}->{dest} ({flight}): {points} {program} pts + ${surcharge:.2f} taxes (or {cash_str} cash)")
            else:
                cash_str = f"${cash:.2f}" if cash else "$0.00"
                print(f"  💵 {origin}->{dest} ({flight}): {cash_str} cash only")
        
        # Count edges by route and type
        fll_jfk = sum(1 for k in edges_all.keys() if k[0] == 'FLL' and k[1] == 'JFK')
        jfk_fll = sum(1 for k in edges_all.keys() if k[0] == 'JFK' and k[1] == 'FLL')
        total_award = sum(1 for v in edges_all.values() if v.get('points_cost') is not None)
        
        print(f"\nRoute breakdown:")
        print(f"  FLL->JFK: {fll_jfk} options ({sum(1 for k,v in edges_all.items() if k[0]=='FLL' and k[1]=='JFK' and v.get('points_cost') is not None)} with award)")
        print(f"  JFK->FLL: {jfk_fll} options ({sum(1 for k,v in edges_all.items() if k[0]=='JFK' and k[1]=='FLL' and v.get('points_cost') is not None)} with award)")
        print(f"  Total award seats: {total_award}")
        print()
        
        # Skip ILP optimization and directly show best separate one-way flights
        print("=" * 80)
        print("SELECTING BEST ONE-WAY FLIGHTS")
        print("=" * 80)
        print("Booking flights separately (not as round-trip) for best pricing...")
        
        # Show manual flight recommendations (booking separately)
        if edges_all:
            print("\n" + "=" * 80)
            print("MAXIMIZING POINTS USAGE - ONE-WAY BOOKINGS")
            print("=" * 80)
            
            # Find all outbound and return flights
            outbound_flights = [(k, v) for k, v in edges_all.items() if k[0] == 'FLL' and k[1] == 'JFK']
            return_flights = [(k, v) for k, v in edges_all.items() if k[0] == 'JFK' and k[1] == 'FLL']
            
            # Separate flights into award vs cash-only
            outbound_award = [(k, v) for k, v in outbound_flights if v.get('points_cost') is not None]
            outbound_cash = [(k, v) for k, v in outbound_flights if v.get('points_cost') is None]
            return_award = [(k, v) for k, v in return_flights if v.get('points_cost') is not None]
            return_cash = [(k, v) for k, v in return_flights if v.get('points_cost') is None]
            
            print(f"\n📊 Flight Availability:")
            print(f"   Outbound: {len(outbound_award)} award seats, {len(outbound_cash)} cash-only")
            print(f"   Return: {len(return_award)} award seats, {len(return_cash)} cash-only")
            print()
            
            # Strategy: Maximize points usage
            # Sort award flights by points cost (prefer using more points to maximize redemption)
            if outbound_award:
                outbound_award.sort(key=lambda x: x[1].get('points_cost', 0), reverse=True)
            if return_award:
                return_award.sort(key=lambda x: x[1].get('points_cost', 0), reverse=True)
            
            # Sort cash flights by cash cost (prefer cheaper)
            outbound_cash.sort(key=lambda x: x[1].get('cash_cost', float('inf')))
            return_cash.sort(key=lambda x: x[1].get('cash_cost', float('inf')))
            
            # Select best flights: prioritize award flights to maximize points usage
            best_outbound = outbound_award[0] if outbound_award else outbound_cash[0] if outbound_cash else None
            best_return = return_award[0] if return_award else return_cash[0] if return_cash else None
            
            if best_outbound and best_return:
                # Calculate costs
                outbound_points = best_outbound[1].get('points_cost', 0) or 0
                outbound_cash = best_outbound[1].get('points_surcharge', 0) if best_outbound[1].get('points_cost') else best_outbound[1].get('cash_cost', 0)
                outbound_program = best_outbound[1].get('points_program', 'N/A')
                
                return_points = best_return[1].get('points_cost', 0) or 0
                return_cash = best_return[1].get('points_surcharge', 0) if best_return[1].get('points_cost') else best_return[1].get('cash_cost', 0)
                return_program = best_return[1].get('points_program', 'N/A')
                
                total_points = outbound_points + return_points
                total_cash = outbound_cash + return_cash
                total_time = best_outbound[1].get('time_cost', 0) + best_return[1].get('time_cost', 0)
                
                # Check if Chase can transfer to these programs
                chase_available = user_points['traveler1']['chase']
                can_book_outbound = outbound_program in transfer_graph_custom.get('chase', {}) or outbound_points == 0
                can_book_return = return_program in transfer_graph_custom.get('chase', {}) or return_points == 0
                
                print("\n🛫 OUTBOUND (One-way): Fort Lauderdale → New York City")
                print("-" * 80)
                edge_key = best_outbound[0]
                edge_data = best_outbound[1]
                print(f"Flight Number: {edge_key[2]}")
                print(f"Airline: {edge_data.get('operating_airline', 'N/A')}")
                print(f"Date: {start_date}")
                print(f"Departure: {edge_data.get('departure_time', 'N/A')}")
                print(f"Arrival: {edge_data.get('arrival_time', 'N/A')}")
                print(f"Duration: {edge_data.get('time_cost', 0)} minutes ({edge_data.get('time_cost', 0)/60:.1f} hours)")
                
                if edge_data.get('points_cost'):
                    print(f"\n✅ BOOK WITH POINTS:")
                    print(f"   {edge_data['points_cost']:,} {edge_data.get('points_program', '')} miles")
                    print(f"   + ${edge_data.get('points_surcharge', 0):.2f} taxes/fees")
                    if edge_data.get('points_program') in transfer_graph_custom.get('chase', {}):
                        print(f"   💳 Transfer {edge_data['points_cost']:,} Chase UR → {edge_data.get('points_program')} at 1:1")
                    print(f"\n   Or pay cash: ${edge_data.get('cash_cost', 0):.2f}")
                else:
                    print(f"\n❌ Award seats not available")
                    print(f"   Pay cash: ${edge_data.get('cash_cost', 0):.2f}")
                
                print("\n🛬 RETURN (One-way): New York City → Fort Lauderdale")
                print("-" * 80)
                edge_key = best_return[0]
                edge_data = best_return[1]
                print(f"Flight Number: {edge_key[2]}")
                print(f"Airline: {edge_data.get('operating_airline', 'N/A')}")
                print(f"Date: {end_date}")
                print(f"Departure: {edge_data.get('departure_time', 'N/A')}")
                print(f"Arrival: {edge_data.get('arrival_time', 'N/A')}")
                print(f"Duration: {edge_data.get('time_cost', 0)} minutes ({edge_data.get('time_cost', 0)/60:.1f} hours)")
                
                if edge_data.get('points_cost'):
                    print(f"\n✅ BOOK WITH POINTS:")
                    print(f"   {edge_data['points_cost']:,} {edge_data.get('points_program', '')} miles")
                    print(f"   + ${edge_data.get('points_surcharge', 0):.2f} taxes/fees")
                    if edge_data.get('points_program') in transfer_graph_custom.get('chase', {}):
                        print(f"   💳 Transfer {edge_data['points_cost']:,} Chase UR → {edge_data.get('points_program')} at 1:1")
                    print(f"\n   Or pay cash: ${edge_data.get('cash_cost', 0):.2f}")
                else:
                    print(f"\n❌ Award seats not available")
                    print(f"   Pay cash: ${edge_data.get('cash_cost', 0):.2f}")
                
                print("\n" + "=" * 80)
                print("MAXIMUM POINTS USAGE STRATEGY")
                print("=" * 80)
                
                cash_limit = trip_request["budget_preferences"]["cash_limit"]
                points_available = trip_request["loyalty_wallet"]["chase_ultimate_rewards"]
                
                if total_points > 0:
                    print(f"\n✈️ POINTS REDEMPTION:")
                    print(f"   Total points needed: {total_points:,}")
                    print(f"   Total cash (taxes/fees): ${total_cash:.2f}")
                    print(f"\n   Breakdown:")
                    if outbound_points > 0:
                        print(f"   • Outbound: {outbound_points:,} {outbound_program} points + ${outbound_cash:.2f}")
                    else:
                        print(f"   • Outbound: ${outbound_cash:.2f} cash (no award seats)")
                    if return_points > 0:
                        print(f"   • Return: {return_points:,} {return_program} points + ${return_cash:.2f}")
                    else:
                        print(f"   • Return: ${return_cash:.2f} cash (no award seats)")
                    
                    print(f"\n💳 CHASE ULTIMATE REWARDS:")
                    print(f"   Available: {points_available:,}")
                    print(f"   Transfer needed: {total_points:,}")
                    print(f"   Remaining after transfer: {points_available - total_points:,}")
                    
                    points_affordable = total_points <= points_available
                    cash_affordable = total_cash <= cash_limit
                    
                    print(f"\n📊 AFFORDABILITY:")
                    print(f"   {'✅' if points_affordable else '❌'} Points: {total_points:,} / {points_available:,} available")
                    print(f"   {'✅' if cash_affordable else '❌'} Cash: ${total_cash:.2f} / ${cash_limit} budget")
                    print(f"   {'✅ CAN BOOK WITH POINTS!' if (points_affordable and cash_affordable) else '❌ Insufficient points or cash'}")
                    
                    print(f"\n⏱️ Total Flight Time: {total_time} minutes ({total_time/60:.1f} hours)")
                    
                else:
                    print(f"\n❌ NO AWARD SEATS AVAILABLE")
                    print(f"   All flights must be booked with cash")
                    print(f"\n💵 CASH COST:")
                    print(f"   Outbound: ${outbound_cash:.2f}")
                    print(f"   Return: ${return_cash:.2f}")
                    print(f"   Total: ${total_cash:.2f}")
                    
                    cash_affordable = total_cash <= cash_limit
                    print(f"\n📊 AFFORDABILITY:")
                    print(f"   Your budget: ${cash_limit}")
                    print(f"   Total cost: ${total_cash:.2f}")
                    print(f"   Remaining: ${cash_limit - total_cash:.2f}")
                    print(f"   {'✅ WITHIN BUDGET' if cash_affordable else '❌ OVER BUDGET'}")
                    
                    print(f"\n💳 Your {points_available:,} Chase UR points remain unused")
                    print(f"   💡 Try different dates for award availability")
                    
                    print(f"\n⏱️ Total Flight Time: {total_time} minutes ({total_time/60:.1f} hours)")
                
                # Show alternative options
                print("\n" + "=" * 80)
                print("ALTERNATIVE FLIGHT OPTIONS")
                print("=" * 80)
                
                if isinstance(outbound_award, list) and len(outbound_award) > 1:
                    print("\n✈️ Other Outbound AWARD Flights:")
                    for i, (k, v) in enumerate(outbound_award[1:4], 1):
                        pts = v.get('points_cost', 0)
                        prog = v.get('points_program', '')
                        surcharge = v.get('points_surcharge', 0)
                        time = v.get('departure_time', 'N/A')
                        print(f"  {i}. {k[2]}: {pts:,} {prog} pts + ${surcharge:.2f} ({time})")
                
                if isinstance(outbound_cash, list) and len(outbound_cash) > 1:
                    print("\n💵 Other Outbound CASH Flights:")
                    for i, (k, v) in enumerate(outbound_cash[1:4], 1):
                        cash = v.get('cash_cost', 0)
                        time = v.get('departure_time', 'N/A')
                        print(f"  {i}. {k[2]}: ${cash:.2f} ({time})")
                
                if isinstance(return_award, list) and len(return_award) > 1:
                    print("\n✈️ Other Return AWARD Flights:")
                    for i, (k, v) in enumerate(return_award[1:4], 1):
                        pts = v.get('points_cost', 0)
                        prog = v.get('points_program', '')
                        surcharge = v.get('points_surcharge', 0)
                        time = v.get('departure_time', 'N/A')
                        print(f"  {i}. {k[2]}: {pts:,} {prog} pts + ${surcharge:.2f} ({time})")
                
                if isinstance(return_cash, list) and len(return_cash) > 1:
                    print("\n💵 Other Return CASH Flights:")
                    for i, (k, v) in enumerate(return_cash[1:4], 1):
                        cash = v.get('cash_cost', 0)
                        time = v.get('departure_time', 'N/A')
                        print(f"  {i}. {k[2]}: ${cash:.2f} ({time})")
        
        print("\n" + "=" * 80)
        
    except Exception as e:
        print(f"Error planning trip: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    asyncio.run(test_fll_to_nyc())
