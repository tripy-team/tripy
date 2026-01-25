#!/usr/bin/env python3
"""
CLI debug runner for v2 itinerary generation.

Usage:
    python -m src.scripts.itinerary_v2_cli --trip-id <trip_id>
    
Example:
    python -m src.scripts.itinerary_v2_cli --trip-id abc123
"""

import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

# Ensure backend root is on sys.path
_backend = Path(__file__).resolve().parent.parent.parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))


def setup_logging(verbose: bool = False):
    """Configure logging for CLI output."""
    level = logging.DEBUG if verbose else logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )


async def run_v2_generation(trip_id: str) -> dict:
    """Run v2 itinerary generation for a trip."""
    from src.system.itinerary_v2.pipeline import generate_itinerary_v2
    
    print(f"\n{'=' * 60}")
    print(f"Running v2 itinerary generation for trip: {trip_id}")
    print(f"{'=' * 60}\n")
    
    result = await generate_itinerary_v2(trip_id)
    
    return result


def format_result(result: dict) -> str:
    """Format result for display."""
    output = []
    
    status = result.get("status", "Unknown")
    output.append(f"\nStatus: {status}")
    
    items = result.get("items", [])
    output.append(f"Items generated: {len(items)}")
    
    # Summarize items by type
    by_type = {}
    for item in items:
        t = item.get("type", "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    output.append(f"Item types: {by_type}")
    
    # Show path if available
    for item in items:
        if item.get("type") == "path":
            path = item.get("path", [])
            cost = item.get("totalCost", 0)
            points = item.get("pointsCost", 0)
            output.append(f"\nPath: {' -> '.join(path)}")
            output.append(f"Total Cash: ${cost:,.0f}")
            output.append(f"Total Points: {points:,}")
    
    # Show totals if available
    for item in items:
        if item.get("type") == "totals":
            totals = item.get("totals", {})
            output.append(f"\nTotals:")
            output.append(f"  Cash: ${totals.get('cash', 0):,.0f}")
            output.append(f"  Airline Points: {totals.get('airline_points', 0):,.0f}")
            output.append(f"  Points Value: ${totals.get('points_value', 0):,.0f}")
    
    # Show relaxation message if present
    if result.get("relaxed_message"):
        output.append(f"\nNote: {result['relaxed_message']}")
    
    return "\n".join(output)


def main():
    parser = argparse.ArgumentParser(
        description="Run v2 itinerary generation for a trip"
    )
    parser.add_argument(
        "--trip-id",
        required=True,
        help="Trip ID to generate itinerary for",
    )
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Enable verbose logging",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output raw JSON result",
    )
    
    args = parser.parse_args()
    
    setup_logging(args.verbose)
    
    try:
        result = asyncio.run(run_v2_generation(args.trip_id))
        
        if args.json:
            print(json.dumps(result, indent=2, default=str))
        else:
            print(format_result(result))
            print("\n" + "=" * 60)
            print("Generation complete!")
            print("=" * 60 + "\n")
            
    except ValueError as e:
        print(f"\nError: {e}\n", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}\n", file=sys.stderr)
        if args.verbose:
            import traceback
            traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
