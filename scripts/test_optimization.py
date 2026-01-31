#!/usr/bin/env python3
"""
Test script for solo trip optimization.

This script creates a test trip, adds destinations and points, 
then runs the optimization without needing to use the web UI.

Usage:
    python scripts/test_optimization.py

Environment variables:
    TRIPY_AUTH_TOKEN: Optional JWT token for authentication
    TRIPY_API_URL: API base URL (default: http://127.0.0.1:8000)

Or run with --login to authenticate interactively.
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta
from typing import Optional

try:
    import requests
except ImportError:
    print("Please install requests: pip install requests")
    sys.exit(1)


# Configuration
DEFAULT_API_URL = "http://127.0.0.1:8000"

# Test trip configuration
DEFAULT_CONFIG = {
    "title": "Test Trip - JFK to Dubai",
    "start_city": "New York (JFK,LGA)",  # Format: City Name (IATA codes)
    "end_city": "New York (JFK,LGA)",     # Same as start for round trip
    "destinations": ["Dubai (DXB,DWC)"],  # Must-visit destinations
    "start_date_offset_days": 30,          # Days from now
    "trip_duration_days": 7,
    "max_budget": 5000,
    "points": {
        # Format: program_key -> balance
        "chase_ultimate_rewards": 100000,
        "amex_membership_rewards": 1000000,
        "citi_thankyou_points": 150000,
    }
}


class TripyTestClient:
    def __init__(self, base_url: str, auth_token: Optional[str] = None):
        self.base_url = base_url.rstrip("/")
        self.auth_token = auth_token
        self.session = requests.Session()
        
    def _headers(self):
        headers = {"Content-Type": "application/json"}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"
        return headers
    
    def _request(self, method: str, endpoint: str, data: dict = None):
        url = f"{self.base_url}{endpoint}"
        try:
            if method == "GET":
                resp = self.session.get(url, headers=self._headers(), params=data)
            else:
                resp = self.session.post(url, headers=self._headers(), json=data)
            
            if resp.status_code == 401:
                print(f"❌ Authentication failed. Please provide a valid token.")
                return None
            elif resp.status_code >= 400:
                print(f"❌ API error {resp.status_code}: {resp.text[:500]}")
                return None
            
            return resp.json()
        except requests.exceptions.ConnectionError:
            print(f"❌ Cannot connect to {url}. Is the backend running?")
            return None
        except Exception as e:
            print(f"❌ Request failed: {e}")
            return None

    def health_check(self) -> bool:
        """Check if the API is reachable"""
        try:
            resp = self.session.get(f"{self.base_url}/healthz", timeout=5)
            return resp.status_code == 200
        except:
            return False
    
    def login(self, email: str, password: str) -> Optional[str]:
        """Login and get auth token"""
        result = self._request("POST", "/auth/login", {
            "email": email,
            "password": password
        })
        if result and "access_token" in result:
            self.auth_token = result["access_token"]
            return self.auth_token
        return None
    
    def create_trip(self, title: str, start_date: str, end_date: str, 
                    max_budget: int = None) -> Optional[dict]:
        """Create a new trip"""
        data = {
            "title": title,
            "start_date": start_date,
            "end_date": end_date,
            "include_hotels": False,  # Skip hotels for faster testing
        }
        if max_budget:
            data["max_budget"] = max_budget
        return self._request("POST", "/trips", data)
    
    def add_destination(self, trip_id: str, name: str, 
                        is_start: bool = False, is_end: bool = False,
                        must_include: bool = False) -> Optional[dict]:
        """Add a destination to a trip"""
        return self._request("POST", "/destinations/add", {
            "trip_id": trip_id,
            "name": name,
            "is_start": is_start,
            "is_end": is_end,
            "must_include": must_include,
        })
    
    def upsert_points(self, trip_id: str, program: str, balance: int) -> Optional[dict]:
        """Add or update points balance"""
        return self._request("POST", "/points/upsert", {
            "trip_id": trip_id,
            "program": program,
            "balance": balance,
        })
    
    def generate_itinerary(self, trip_id: str) -> Optional[dict]:
        """Generate optimized itinerary"""
        return self._request("POST", "/itinerary/generate", {
            "trip_id": trip_id,
        })
    
    def get_trip(self, trip_id: str) -> Optional[dict]:
        """Get trip details"""
        return self._request("POST", "/trips/get", {"trip_id": trip_id})
    
    def list_destinations(self, trip_id: str) -> Optional[dict]:
        """List trip destinations"""
        return self._request("POST", "/destinations/list", {"trip_id": trip_id})


def run_test(config: dict, client: TripyTestClient, verbose: bool = False):
    """Run the full test workflow"""
    
    print("\n" + "="*60)
    print("🧪 TRIPY OPTIMIZATION TEST")
    print("="*60)
    
    # Calculate dates
    start_date = datetime.now() + timedelta(days=config["start_date_offset_days"])
    end_date = start_date + timedelta(days=config["trip_duration_days"])
    start_str = start_date.strftime("%Y-%m-%d")
    end_str = end_date.strftime("%Y-%m-%d")
    
    print(f"\n📅 Trip: {start_str} to {end_str} ({config['trip_duration_days']} days)")
    print(f"🏠 Start: {config['start_city']}")
    print(f"🏠 End: {config['end_city']}")
    print(f"🎯 Destinations: {', '.join(config['destinations'])}")
    print(f"💰 Max Budget: ${config.get('max_budget', 'unlimited')}")
    
    # Step 1: Create trip
    print("\n[1/5] Creating trip...")
    trip = client.create_trip(
        title=config["title"],
        start_date=start_str,
        end_date=end_str,
        max_budget=config.get("max_budget")
    )
    if not trip:
        print("❌ Failed to create trip")
        return False
    
    trip_id = trip["tripId"]
    print(f"   ✅ Trip created: {trip_id}")
    
    # Step 2: Add start destination
    print("\n[2/5] Adding destinations...")
    
    # Add start city
    result = client.add_destination(trip_id, config["start_city"], is_start=True)
    if not result:
        print(f"   ❌ Failed to add start city: {config['start_city']}")
        return False
    print(f"   ✅ Start: {config['start_city']}")
    
    # Add end city (if different from start)
    if config["end_city"] != config["start_city"]:
        result = client.add_destination(trip_id, config["end_city"], is_end=True)
        if not result:
            print(f"   ❌ Failed to add end city: {config['end_city']}")
            return False
        print(f"   ✅ End: {config['end_city']}")
    else:
        # For round trips, mark start as also end
        # (The API should handle this, but we can also add it explicitly)
        print(f"   ✅ End: Same as start (round trip)")
    
    # Add must-visit destinations
    for dest in config["destinations"]:
        result = client.add_destination(trip_id, dest, must_include=True)
        if not result:
            print(f"   ❌ Failed to add destination: {dest}")
            return False
        print(f"   ✅ Must-visit: {dest}")
    
    # Step 3: Add points balances
    print("\n[3/5] Adding points balances...")
    for program, balance in config["points"].items():
        result = client.upsert_points(trip_id, program, balance)
        if not result:
            print(f"   ❌ Failed to add {program}: {balance:,}")
            # Continue anyway - points are optional
        else:
            print(f"   ✅ {program}: {balance:,} points")
    
    # Step 4: Verify setup
    print("\n[4/5] Verifying trip setup...")
    trip_info = client.get_trip(trip_id)
    if trip_info and verbose:
        print(f"   Trip: {json.dumps(trip_info, indent=2)[:500]}...")
    
    destinations = client.list_destinations(trip_id)
    if destinations:
        dest_list = destinations.get("destinations", [])
        print(f"   ✅ {len(dest_list)} destinations configured")
        for d in dest_list:
            flags = []
            if d.get("isStart"): flags.append("START")
            if d.get("isEnd"): flags.append("END")
            if d.get("mustInclude"): flags.append("MUST-VISIT")
            flag_str = f" [{', '.join(flags)}]" if flags else ""
            print(f"      - {d.get('name')}{flag_str}")
    
    # Step 5: Generate itinerary
    print("\n[5/5] Generating optimized itinerary...")
    print("   (This may take 30-60 seconds...)")
    
    import time
    start_time = time.time()
    
    result = client.generate_itinerary(trip_id)
    
    elapsed = time.time() - start_time
    print(f"   ⏱️  Completed in {elapsed:.1f} seconds")
    
    if not result:
        print("   ❌ Failed to generate itinerary")
        return False
    
    status = result.get("status", "unknown")
    print(f"\n{'='*60}")
    print(f"📊 RESULT: {status}")
    print(f"{'='*60}")
    
    if status == "error":
        print(f"\n❌ Optimization failed:")
        print(f"   Error: {result.get('message', 'Unknown error')}")
        if result.get("user_actions"):
            print("\n   Suggested actions:")
            for action in result["user_actions"]:
                print(f"   - {action.get('title')}: {action.get('description')}")
        return False
    
    if status == "Optimal":
        print("\n✅ Optimization successful!")
        
        solution = result.get("solution", {})
        totals = solution.get("totals", {})
        
        print(f"\n💵 Out of Pocket: ${result.get('out_of_pocket', totals.get('cash', 0)):,.0f}")
        print(f"✈️  Points Used: {totals.get('airline_points', 0):,.0f}")
        print(f"💰 Points Value: ${totals.get('points_value', 0):,.0f}")
        
        # Show path
        paths = solution.get("path", {})
        for traveler, path in paths.items():
            print(f"\n🗺️  Route: {' → '.join(path)}")
        
        # Show payment details
        pay_modes = solution.get("pay_mode", {})
        for traveler, payments in pay_modes.items():
            print(f"\n📝 Flight payments:")
            for pm in payments:
                edge = pm.get("edge", [])
                route = f"{edge[0]} → {edge[1]}" if len(edge) >= 2 else str(edge)
                if pm.get("type") == "cash":
                    print(f"   💵 {route}: ${pm.get('fare', 0):,.0f} cash")
                else:
                    via = pm.get("via", {})
                    if "native" in via:
                        print(f"   ✈️  {route}: {pm.get('miles', 0):,.0f} {via['native']} miles + ${pm.get('surcharge', 0):,.0f}")
                    else:
                        print(f"   🔄 {route}: {pm.get('miles', 0):,.0f} miles (via {via.get('source', '?')} → {via.get('airline', '?')}) + ${pm.get('surcharge', 0):,.0f}")
        
        # Show transfers
        transfers = totals.get("transfers", {})
        if any(transfers.values()):
            print(f"\n🔄 Point Transfers:")
            for traveler, sources in transfers.items():
                for source, airlines in sources.items():
                    for airline, details in airlines.items():
                        print(f"   {source}: {details.get('source_points', 0):,} → {airline} ({details.get('delivered_airline_points', 0):,} miles)")
        
        return True
    else:
        print(f"\n⚠️  Unexpected status: {status}")
        if verbose:
            print(f"   Full result: {json.dumps(result, indent=2)[:1000]}")
        return False


def main():
    parser = argparse.ArgumentParser(description="Test Tripy optimization")
    parser.add_argument("--api-url", default=os.environ.get("TRIPY_API_URL", DEFAULT_API_URL),
                        help="API base URL")
    parser.add_argument("--token", default=os.environ.get("TRIPY_AUTH_TOKEN"),
                        help="JWT auth token")
    parser.add_argument("--login", action="store_true",
                        help="Login interactively")
    parser.add_argument("--email", help="Email for login")
    parser.add_argument("--password", help="Password for login")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Verbose output")
    
    # Trip configuration overrides
    parser.add_argument("--start", help="Start city (e.g., 'New York (JFK,LGA)')")
    parser.add_argument("--end", help="End city (default: same as start)")
    parser.add_argument("--dest", action="append", help="Destination to visit (can specify multiple)")
    parser.add_argument("--days", type=int, help="Trip duration in days")
    parser.add_argument("--budget", type=int, help="Max budget in dollars")
    parser.add_argument("--offset", type=int, help="Days from now to start trip")
    
    args = parser.parse_args()
    
    # Build configuration
    config = DEFAULT_CONFIG.copy()
    if args.start:
        config["start_city"] = args.start
    if args.end:
        config["end_city"] = args.end
    elif args.start:
        config["end_city"] = args.start  # Default to round trip
    if args.dest:
        config["destinations"] = args.dest
    if args.days:
        config["trip_duration_days"] = args.days
    if args.budget:
        config["max_budget"] = args.budget
    if args.offset:
        config["start_date_offset_days"] = args.offset
    
    # Create client
    client = TripyTestClient(args.api_url, args.token)
    
    # Check API health
    print(f"🔗 Connecting to {args.api_url}...")
    if not client.health_check():
        print("❌ Cannot connect to API. Is the backend running?")
        print(f"   Try: cd backend && uvicorn src.app:app --port 8000 --reload")
        sys.exit(1)
    print("✅ API is reachable")
    
    # Handle authentication
    if args.login or (not args.token and not args.email):
        if not args.email:
            args.email = input("Email: ")
        if not args.password:
            import getpass
            args.password = getpass.getpass("Password: ")
        
        print("🔐 Logging in...")
        token = client.login(args.email, args.password)
        if not token:
            print("❌ Login failed")
            sys.exit(1)
        print("✅ Login successful")
    elif args.email and args.password:
        print("🔐 Logging in...")
        token = client.login(args.email, args.password)
        if not token:
            print("❌ Login failed")
            sys.exit(1)
        print("✅ Login successful")
    elif not args.token:
        print("⚠️  No authentication provided.")
        print("   Use --token, --login, or set TRIPY_AUTH_TOKEN environment variable")
        print("   Or provide --email and --password")
        sys.exit(1)
    
    # Run test
    success = run_test(config, client, args.verbose)
    
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
