#!/usr/bin/env python3
"""
Script to fetch award availability calendar using the AwardTool Panorama API.

This script demonstrates a single-request API interaction:
- Fetches a calendar of award availability for a route across all programs
- Shows points required per cabin class for each date
- Useful for finding the best dates to book award travel

The Panorama calendar provides a 330-day forward view of award availability.

API Documentation: https://documenter.getpostman.com/view/31698313/2s9YkgERfa

TESTED AND WORKING as of January 2026.
"""

import requests
import json
from datetime import datetime
from loguru import logger

# ============================================================================
# API Configuration
# ============================================================================

# Panorama calendar endpoint (synchronous, no polling needed)
PANORAMA_URL = "https://www.awardtool-api.com/panorama/panorama_calendar_data"

# API authentication key
API_KEY = "0363cfd0-ba6a-4302-ba14-9f86186eb0c7"

# ============================================================================
# Request Configuration
# ============================================================================

# Route to search (origin-destination format)
ORIGIN = "JFK"
DESTINATION = "LHR"

# Request body for panorama calendar
request_body = {
    "id": f"{ORIGIN}-{DESTINATION}",  # Route ID format: ORIGIN-DESTINATION
    "api_key": API_KEY,
}

# HTTP headers
headers = {
    "Content-Type": "application/json"
}

# Cabin class mappings from API response
# y = economy, w = premium economy, j = business, f = first
CABIN_KEYS = {
    "y": "Economy",
    "w": "Premium Economy", 
    "j": "Business",
    "f": "First",
}


def fetch_panorama_calendar():
    """
    Fetch the panorama calendar for a route.

    Returns:
        dict: Full API response with calendar data
    """
    logger.info("=" * 60)
    logger.info("AwardTool Panorama Calendar API Request")
    logger.info("=" * 60)
    logger.info(f"Endpoint: {PANORAMA_URL}")
    logger.info(f"Route: {ORIGIN} -> {DESTINATION}")
    logger.info("=" * 60)

    try:
        response = requests.post(
            PANORAMA_URL,
            json=request_body,
            headers=headers,
            timeout=20
        )
        
        logger.info(f"Response Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            calendar_data = data.get("data", [])
            logger.success(f"Retrieved {len(calendar_data)} calendar entries!")
            return data
        else:
            logger.error(f"Request failed: {response.status_code} - {response.text[:500]}")
            return {"error": response.text, "status_code": response.status_code}
            
    except requests.exceptions.Timeout:
        logger.error("Request timed out after 20 seconds")
        return None
    except requests.exceptions.RequestException as e:
        logger.error(f"Request failed: {e}")
        return None


def normalize_calendar_row(row):
    """
    Normalize a single calendar row into a readable format.
    
    API Response Structure per row:
    - date: Travel date (YYYY-MM-DD)
    - program: Airline program code (e.g., "UA", "AA", "VS")
    - route: Route string
    - points: Object containing:
        - y, w, j, f: Points for Economy, Premium Economy, Business, First
        - tax: Object with cabin keys for taxes/fees
        - c_a: Operating carriers per cabin
        - c_s: Available seats per cabin
        - ss: Availability status per cabin (flag indicating availability)
        - ls: Last seen timestamp
    - points_ns: Non-stop points (if different from connecting)
    """
    date = row.get("date")
    program = (row.get("program") or "").upper()
    route = row.get("route", "")
    points = row.get("points", {})
    points_ns = row.get("points_ns", {})
    
    cabins = {}
    for key, name in CABIN_KEYS.items():
        pts = points.get(key)
        tax = (points.get("tax") or {}).get(key)
        airlines = (points.get("c_a") or {}).get(key, [])
        seats = (points.get("c_s") or {}).get(key)
        available = (points.get("ss") or {}).get(key)
        nonstop_pts = points_ns.get(key)
        
        cabins[name] = {
            "points": int(pts) if isinstance(pts, (int, float)) else None,
            "tax": tax if isinstance(tax, (int, float)) else None,
            "airlines": airlines,
            "seats": seats,
            "available": bool(available),
            "nonstop_points": int(nonstop_pts) if isinstance(nonstop_pts, (int, float)) else None,
        }
    
    return {
        "date": date,
        "program": program,
        "route": route,
        "cabins": cabins,
        "last_seen": points.get("ls"),
    }


def find_best_dates(calendar_data, cabin="Business", top_k=5, require_available=True):
    """
    Find the best dates (lowest points) for a given cabin class.
    
    Args:
        calendar_data: Raw calendar data from API
        cabin: Cabin class (Economy, Premium Economy, Business, First)
        top_k: Number of top dates to return
        require_available: Only include dates with availability flag
    
    Returns:
        List of dicts with date, program, points, tax, nonstop_points
    """
    results = []
    
    for row in calendar_data:
        normalized = normalize_calendar_row(row)
        cab_data = normalized.get("cabins", {}).get(cabin, {})
        points = cab_data.get("points")
        available = cab_data.get("available")
        
        if points is None:
            continue
        if require_available and not available:
            continue
            
        results.append({
            "date": normalized["date"],
            "program": normalized["program"],
            "points": points,
            "tax": cab_data.get("tax"),
            "nonstop_points": cab_data.get("nonstop_points"),
            "available": available,
            "airlines": cab_data.get("airlines", []),
        })
    
    # Sort by points (lowest first)
    results.sort(key=lambda x: x["points"])
    return results[:top_k]


def display_results(data):
    """Display calendar results and best dates per cabin."""
    
    if not data:
        return
    
    if "error" in data:
        logger.error(f"API returned error: {data}")
        return
    
    calendar_data = data.get("data", [])
    
    if not calendar_data:
        logger.warning("No calendar data returned")
        logger.info(f"Full response: {json.dumps(data, indent=2)[:1000]}")
        return
    
    # Show sample raw entry
    logger.info("=" * 60)
    logger.info("Sample Raw Entry:")
    logger.info(json.dumps(calendar_data[0], indent=2)[:600])
    logger.info("=" * 60)
    
    # Count entries per program
    program_counts = {}
    for row in calendar_data:
        prog = row.get("program", "Unknown")
        program_counts[prog] = program_counts.get(prog, 0) + 1
    
    logger.info("\nPrograms in calendar:")
    for prog in sorted(program_counts.keys()):
        logger.info(f"  {prog}: {program_counts[prog]} entries")
    
    # Best dates per cabin
    logger.info("\n" + "=" * 60)
    logger.info("Best Dates by Cabin Class (with availability)")
    logger.info("=" * 60)
    
    for cabin in ["Economy", "Premium Economy", "Business", "First"]:
        best = find_best_dates(calendar_data, cabin, top_k=5, require_available=True)
        
        logger.info(f"\n{cabin}:")
        if not best:
            logger.info("  No availability found")
            continue
            
        for i, entry in enumerate(best, 1):
            pts_str = f"{entry['points']:,}"
            ns_str = f" (nonstop: {entry['nonstop_points']:,})" if entry.get('nonstop_points') else ""
            tax_str = f" + ${entry['tax']:.2f} tax" if entry.get('tax') else ""
            airlines_str = f" [{','.join(entry['airlines'])}]" if entry.get('airlines') else ""
            logger.info(f"  {i}. {entry['date']} via {entry['program']}: {pts_str} pts{ns_str}{tax_str}{airlines_str}")
    
    # Save full normalized data
    normalized = [normalize_calendar_row(r) for r in calendar_data]
    output = {
        "route": f"{ORIGIN}-{DESTINATION}",
        "entries": len(normalized),
        "programs": list(program_counts.keys()),
        "calendar": normalized,
    }
    
    with open("panorama_calendar.json", "w") as f:
        json.dump(output, f, indent=2)
    logger.info(f"\nSaved full calendar to: panorama_calendar.json")


if __name__ == "__main__":
    data = fetch_panorama_calendar()
    if data:
        display_results(data)
    else:
        logger.error("Failed to fetch panorama calendar")
        exit(1)
