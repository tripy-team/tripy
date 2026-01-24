#!/usr/bin/env python3
"""
Quick test: get_flights_between_airports JFK -> CDG.

This function is used in the itinerary workflow via flights.get_flights_serp_only
(a SERP-only fallback when award-first and SERP-first return no edges).

Run from backend with SERPAPI_KEY or SERP_API_KEY in .env:

  cd backend
  source .venv/bin/activate   # or: python3 -m venv .venv && source .venv/bin/activate
  pip install -r requirements.txt   # if needed
  PYTHONPATH=. python test_serp_flights.py
"""
import os
import sys

# Ensure backend src is on path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load .env from backend if present
try:
    from dotenv import load_dotenv
    load_dotenv()
except Exception:
    pass

try:
    from src.handlers.serp_client import get_flights_between_airports, pick_cheapest
except ImportError as e:
    print("Import failed:", e)
    print("\nTo run this test:")
    print("  cd backend")
    print("  python3 -m venv .venv && source .venv/bin/activate")
    print("  pip install -r requirements.txt")
    print("  # Set SERPAPI_KEY or SERP_API_KEY in .env")
    print("  PYTHONPATH=. python test_serp_flights.py")
    sys.exit(1)

def main():
    origin, dest, date = "JFK", "CDG", "2025-03-15"
    key = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
    print(f"Searching {origin} -> {dest} on {date} ...")
    print(f"SERPAPI_KEY set: {bool(key)}")
    flights = get_flights_between_airports(origin, dest, date)
    print(f"Found {len(flights)} flight options\n")

    if not flights:
        print("No flights returned. Set SERPAPI_KEY or SERP_API_KEY in .env to test.")
        return

    cheap = pick_cheapest(flights)
    if cheap:
        print(f"Cheapest: ${cheap.get('price')} | {len(cheap.get('flights', []))} leg(s)\n")

    for i, opt in enumerate(flights[:8]):
        legs = opt.get("flights") or []
        route = " -> ".join(
            f"{lg.get('departure_airport', {}).get('id', '?')}-{lg.get('arrival_airport', {}).get('id', '?')}"
            for lg in legs
        ) if legs else "?"
        dur = opt.get("total_duration") or ""
        print(f"  [{i+1}] ${opt.get('price', 'N/A'):>6} | {len(legs)} leg(s) | {dur:12} | {route}")

    if len(flights) > 8:
        print(f"  ... and {len(flights) - 8} more")

if __name__ == "__main__":
    main()
