#!/usr/bin/env python3
"""
Diagnostic script to test city search autocomplete functionality.
Run this script to diagnose backend issues with city search.
"""

import os
import sys
import json
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


def check_environment():
    """Check if required environment variables are set"""
    print("=" * 60)
    print("1. Checking Environment Variables")
    print("=" * 60)

    client_id = os.getenv("AMADEUS_CLIENT_ID")
    client_secret = os.getenv("AMADEUS_CLIENT_SECRET")

    if not client_id:
        print("❌ AMADEUS_CLIENT_ID is not set")
    else:
        print(f"✅ AMADEUS_CLIENT_ID is set: {client_id[:10]}...")

    if not client_secret:
        print("❌ AMADEUS_CLIENT_SECRET is not set")
    else:
        print(f"✅ AMADEUS_CLIENT_SECRET is set: {client_secret[:10]}...")

    return client_id and client_secret


def test_amadeus_import():
    """Test if Amadeus package is installed"""
    print("\n" + "=" * 60)
    print("2. Checking Amadeus Package")
    print("=" * 60)

    try:
        from amadeus import Client as Amadeus

        print("✅ Amadeus package is installed")
        return True
    except ImportError as e:
        print(f"❌ Amadeus package not installed: {e}")
        print("   Install with: pip install amadeus")
        return False


def test_amadeus_connection():
    """Test Amadeus API connection"""
    print("\n" + "=" * 60)
    print("3. Testing Amadeus API Connection")
    print("=" * 60)

    try:
        from amadeus import Client as Amadeus

        client_id = os.getenv("AMADEUS_CLIENT_ID")
        client_secret = os.getenv("AMADEUS_CLIENT_SECRET")

        if not client_id or not client_secret:
            print("❌ Cannot test - credentials not set")
            return False

        amadeus = Amadeus(client_id=client_id, client_secret=client_secret)
        print("✅ Amadeus client created successfully")

        # Test with a simple search
        test_query = "New York"
        print(f"\n   Testing search with query: '{test_query}'")

        try:
            response = amadeus.reference_data.locations.get(keyword=test_query, max=5)

            if response.data:
                print(f"✅ API call successful - received {len(response.data)} results")
                print(f"   First result: {response.data[0].get('name', 'N/A')}")
                return True
            else:
                print("⚠️  API call successful but no results returned")
                return True

        except Exception as api_error:
            print(f"❌ API call failed: {api_error}")
            print(f"   Error type: {type(api_error).__name__}")
            return False

    except Exception as e:
        print(f"❌ Failed to create Amadeus client: {e}")
        print(f"   Error type: {type(e).__name__}")
        return False


def test_city_service():
    """Test the city_service module directly"""
    print("\n" + "=" * 60)
    print("4. Testing City Service Module")
    print("=" * 60)

    try:
        # Import the service
        sys.path.insert(0, os.path.join(os.path.dirname(__file__), "src"))
        from services import city_service

        test_queries = ["New York", "Paris", "Tokyo"]

        for query in test_queries:
            print(f"\n   Testing query: '{query}'")
            try:
                results = city_service.search_cities(query, max_results=5)
                if results:
                    print(f"   ✅ Got {len(results)} results")
                    print(f"   First result: {json.dumps(results[0], indent=6)}")
                else:
                    print(f"   ⚠️  No results returned")
            except Exception as e:
                print(f"   ❌ Error: {e}")
                print(f"   Error type: {type(e).__name__}")

        return True

    except Exception as e:
        print(f"❌ Failed to import city_service: {e}")
        print(f"   Error type: {type(e).__name__}")
        import traceback

        traceback.print_exc()
        return False


def test_api_endpoint():
    """Test the API endpoint (if server is running)"""
    print("\n" + "=" * 60)
    print("5. Testing API Endpoint")
    print("=" * 60)

    import requests

    # Try to determine the API URL
    api_url = os.getenv("API_URL", "http://localhost:8000")
    endpoint = f"{api_url}/cities/search"

    test_query = "New York"
    url = f"{endpoint}?query={test_query}&max_results=5"

    print(f"   Testing endpoint: {url}")

    try:
        response = requests.get(url, timeout=5)

        if response.status_code == 200:
            data = response.json()
            print(f"   ✅ API endpoint responded successfully")
            print(f"   Response: {json.dumps(data, indent=2)}")
            return True
        else:
            print(f"   ❌ API endpoint returned status {response.status_code}")
            print(f"   Response: {response.text}")
            return False

    except requests.exceptions.ConnectionError:
        print(f"   ⚠️  Cannot connect to API endpoint (server may not be running)")
        print(f"   Start the server with: python -m backend.src.app")
        return None
    except Exception as e:
        print(f"   ❌ Error calling API endpoint: {e}")
        return False


def main():
    """Run all diagnostic checks"""
    print("\n" + "=" * 60)
    print("CITY SEARCH AUTocomplETE DIAGNOSTIC TOOL")
    print("=" * 60)

    results = {
        "environment": check_environment(),
        "amadeus_import": test_amadeus_import(),
        "amadeus_connection": False,
        "city_service": False,
        "api_endpoint": None,
    }

    if results["amadeus_import"]:
        results["amadeus_connection"] = test_amadeus_connection()

    if results["environment"] and results["amadeus_import"]:
        results["city_service"] = test_city_service()
        results["api_endpoint"] = test_api_endpoint()

    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)

    for check, result in results.items():
        if result is True:
            status = "✅ PASS"
        elif result is False:
            status = "❌ FAIL"
        else:
            status = "⚠️  SKIP"
        print(f"{check:20} {status}")

    print("\n" + "=" * 60)
    print("RECOMMENDATIONS")
    print("=" * 60)

    if not results["environment"]:
        print("• Set AMADEUS_CLIENT_ID and AMADEUS_CLIENT_SECRET in .env file")
        print("  or export them as environment variables")

    if not results["amadeus_import"]:
        print("• Install Amadeus package: pip install amadeus")

    if not results["amadeus_connection"]:
        print("• Check your Amadeus API credentials")
        print(
            "• Verify the credentials are correct at: https://developers.amadeus.com/"
        )
        print("• Check if you're on a free tier with rate limits")

    if results["amadeus_connection"] and not results["city_service"]:
        print("• Check the city_service.py implementation")
        print("• Review backend logs for errors")

    if results["api_endpoint"] is False:
        print("• Check that the FastAPI server is running")
        print("• Verify the endpoint URL and CORS settings")
        print("• Check backend logs for request errors")


if __name__ == "__main__":
    main()
