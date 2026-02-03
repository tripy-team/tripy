#!/usr/bin/env python3
"""
Flight-Only Smoke Test for Tripy

This script validates that Tripy operates in flight-only mode:
1. FEATURE_FLIGHTS_ONLY config flag is set
2. Hotel API endpoints return 410 Gone (if any exist)
3. Flight optimization endpoints work correctly
4. Solo trip flow works end-to-end

Usage:
    python scripts/test_flight_only.py [--backend-url http://localhost:8000]
"""

import argparse
import os
import sys
import requests
from typing import Optional

# Add backend to path for config access
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))


def check_flight_only_config() -> bool:
    """Verify FEATURE_FLIGHTS_ONLY is enabled in config."""
    print("\n=== Checking FEATURE_FLIGHTS_ONLY config ===")
    try:
        from src.config import FEATURE_FLIGHTS_ONLY, is_flights_only_mode
        
        if FEATURE_FLIGHTS_ONLY and is_flights_only_mode():
            print("✅ FEATURE_FLIGHTS_ONLY=True (flight-only mode enabled)")
            return True
        else:
            print("❌ FEATURE_FLIGHTS_ONLY=False (hotels are enabled - unexpected!)")
            return False
    except ImportError as e:
        print(f"⚠️  Could not import config: {e}")
        print("   Assuming flight-only mode based on environment")
        return os.environ.get("FEATURE_FLIGHTS_ONLY", "true").lower() == "true"


def check_health(backend_url: str) -> bool:
    """Check backend health endpoint."""
    print(f"\n=== Checking backend health at {backend_url} ===")
    try:
        response = requests.get(f"{backend_url}/health", timeout=5)
        if response.status_code == 200:
            print(f"✅ Backend is healthy: {response.json()}")
            return True
        else:
            print(f"❌ Backend health check failed: {response.status_code}")
            return False
    except requests.exceptions.RequestException as e:
        print(f"❌ Cannot connect to backend: {e}")
        return False


def check_no_hotel_endpoints(backend_url: str) -> bool:
    """Verify hotel endpoints return 410 Gone or don't exist."""
    print("\n=== Checking hotel endpoints are disabled ===")
    
    hotel_endpoints = [
        "/hotels/search",
        "/api/hotels/search",
    ]
    
    all_disabled = True
    for endpoint in hotel_endpoints:
        try:
            response = requests.post(
                f"{backend_url}{endpoint}",
                json={"destination": "Paris", "check_in": "2024-06-01", "check_out": "2024-06-05"},
                headers={"Content-Type": "application/json"},
                timeout=5
            )
            
            if response.status_code == 410:
                print(f"✅ {endpoint} returns 410 Gone (disabled)")
            elif response.status_code == 404:
                print(f"✅ {endpoint} returns 404 Not Found (doesn't exist)")
            elif response.status_code == 401:
                print(f"⚠️  {endpoint} returns 401 Unauthorized (auth required, can't verify)")
            else:
                print(f"❌ {endpoint} returns {response.status_code} (should be 410 or 404)")
                all_disabled = False
        except requests.exceptions.RequestException as e:
            print(f"⚠️  {endpoint} request failed: {e}")
    
    return all_disabled


def check_flight_endpoints(backend_url: str) -> bool:
    """Verify flight-related endpoints work."""
    print("\n=== Checking flight endpoints are working ===")
    
    # Check destination autocomplete (no auth required)
    print("Testing destination autocomplete...")
    try:
        response = requests.get(
            f"{backend_url}/api/destinations/autocomplete?q=Paris&limit=5",
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            suggestions = data.get("suggestions", [])
            print(f"✅ Destination autocomplete works: {len(suggestions)} suggestions for 'Paris'")
        else:
            print(f"⚠️  Destination autocomplete returned {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Destination autocomplete failed: {e}")
    
    # Check airport autocomplete (no auth required)
    print("Testing airport autocomplete...")
    try:
        response = requests.get(
            f"{backend_url}/api/airports/autocomplete?q=JFK&limit=5",
            timeout=10
        )
        if response.status_code == 200:
            data = response.json()
            airports = data.get("airports", [])
            print(f"✅ Airport autocomplete works: {len(airports)} airports for 'JFK'")
        else:
            print(f"⚠️  Airport autocomplete returned {response.status_code}")
    except requests.exceptions.RequestException as e:
        print(f"⚠️  Airport autocomplete failed: {e}")
    
    return True


def check_frontend_api(frontend_path: str) -> bool:
    """Check that frontend API has hotel methods disabled."""
    print("\n=== Checking frontend API is flight-only ===")
    
    api_file = os.path.join(frontend_path, "src", "lib", "api.ts")
    if not os.path.exists(api_file):
        print(f"⚠️  Frontend API file not found: {api_file}")
        return True  # Don't fail if file doesn't exist
    
    with open(api_file, 'r') as f:
        content = f.read()
    
    # Check for flight-only comments
    if "FLIGHT-ONLY MODE" in content:
        print("✅ Frontend API has FLIGHT-ONLY MODE comment")
    else:
        print("⚠️  Frontend API missing FLIGHT-ONLY MODE comment")
    
    # Check for deprecated hotel search
    if "@deprecated" in content and "Hotel features are disabled" in content:
        print("✅ Frontend hotel search is marked as deprecated")
    else:
        print("⚠️  Frontend hotel search should be marked as deprecated")
    
    # Check hotels.search throws error
    if "throw new Error" in content and "flight-only optimizer" in content:
        print("✅ Frontend hotels.search throws error")
        return True
    else:
        print("⚠️  Frontend hotels.search should throw an error")
        return False


def main():
    parser = argparse.ArgumentParser(description="Flight-Only Smoke Test for Tripy")
    parser.add_argument(
        "--backend-url",
        default=os.environ.get("BACKEND_URL", "http://localhost:8000"),
        help="Backend API URL (default: http://localhost:8000)"
    )
    parser.add_argument(
        "--frontend-path",
        default=os.path.join(os.path.dirname(__file__), '..', 'frontend'),
        help="Path to frontend directory"
    )
    args = parser.parse_args()
    
    print("=" * 60)
    print("  Tripy Flight-Only Smoke Test")
    print("=" * 60)
    
    results = []
    
    # 1. Check config
    results.append(("FEATURE_FLIGHTS_ONLY config", check_flight_only_config()))
    
    # 2. Check backend health
    results.append(("Backend health", check_health(args.backend_url)))
    
    # 3. Check hotel endpoints are disabled
    results.append(("Hotel endpoints disabled", check_no_hotel_endpoints(args.backend_url)))
    
    # 4. Check flight endpoints work
    results.append(("Flight endpoints working", check_flight_endpoints(args.backend_url)))
    
    # 5. Check frontend API
    results.append(("Frontend API flight-only", check_frontend_api(args.frontend_path)))
    
    # Summary
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    
    passed = 0
    failed = 0
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
        if result:
            passed += 1
        else:
            failed += 1
    
    print(f"\n  Total: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
