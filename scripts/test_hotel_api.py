#!/usr/bin/env python3
"""
Script to search for award hotels using the AwardTool Hotel API.

This script demonstrates a single-request API interaction:
- Searches for hotel availability across multiple loyalty programs
- Returns both cash rates and points redemption options

Supported Programs: Hilton (HH), IHG (IHG), Marriott (MAR/Bonvoy), Hyatt (HYATT)

API Documentation: https://documenter.getpostman.com/view/31698313/2sB2iwGF3n

NOTE: As of January 2026, this API has a confirmed SERVER-SIDE BUG.

EVIDENCE:
1. Same API key works perfectly for Flight API (tested: 200 OK)
2. Invalid API keys return proper auth error: "A free account is needed"
3. Valid API key causes crash: UnboundLocalError in Lambda handler
4. Crash happens regardless of destination, dates, or programs

The bug is in AwardTool's code at /root/PromeTasks/alert-api/hello_world/app.py line 146
where 'response' variable is referenced before assignment.

RECOMMENDATION: Contact AwardTool support to report this issue.
The script includes sample data fallback for demonstration purposes.
"""

import requests
import json
from datetime import datetime
from loguru import logger

# ============================================================================
# API Configuration
# ============================================================================

# Single endpoint for hotel search (synchronous, no polling needed)
HOTEL_SEARCH_URL = "https://www.awardtool-api.com/search_hotel"

# API authentication key
API_KEY = "0363cfd0-ba6a-4302-ba14-9f86186eb0c7"

# ============================================================================
# Request Configuration
# ============================================================================

# Search parameters for the hotel search
request_body = {
    "destination": "London",         # City name (not airport code)
    "check_in": "2026-02-06",        # Check-in date YYYY-MM-DD
    "check_out": "2026-02-10",       # Check-out date YYYY-MM-DD
    "guests": 2,                     # Number of guests
    # Hotel loyalty programs to search:
    # HH = Hilton Honors
    # IHG = IHG Rewards
    # MAR = Marriott Bonvoy
    # HYATT = World of Hyatt
    "programs": ["HH", "IHG", "MAR", "HYATT"],
    # Optional: filter by star rating (e.g., "3", "4", "5")
    # "hotel_class": "4",
    "api_key": API_KEY,
}

# HTTP headers for API requests
headers = {
    "Content-Type": "application/json"
}


def search_hotels():
    """
    Search for award hotels using the AwardTool API.

    Expected Request Body:
    {
        "destination": "London",           # City name
        "check_in": "2026-02-06",          # YYYY-MM-DD
        "check_out": "2026-02-10",         # YYYY-MM-DD
        "guests": 2,                       # Number of guests
        "programs": ["HH", "MAR", ...],    # Hotel programs
        "hotel_class": "4",                # Optional: star rating
        "api_key": "your-api-key"
    }
    
    Expected Response:
    {
        "data": [
            {
                "hotel_id": "123",
                "name": "Hotel Name",
                "brand": "Marriott",
                "program_code": "MAR",
                "cash_rate": 250.00,       # Per night
                "points": 35000,           # Per night
                "surcharge": 25.00,        # Taxes/fees
                "star_rating": 4,
                "address": "123 Main St"
            },
            ...
        ]
    }

    Returns:
        dict: API response with hotel results, or error dict
    """
    logger.info("=" * 60)
    logger.info("AwardTool Hotel API Request")
    logger.info("=" * 60)
    logger.info(f"Endpoint: {HOTEL_SEARCH_URL}")
    logger.info(f"Destination: {request_body['destination']}")
    logger.info(f"Dates: {request_body['check_in']} to {request_body['check_out']}")
    logger.info(f"Programs: {request_body['programs']}")
    logger.info(f"Guests: {request_body['guests']}")
    logger.info("=" * 60)

    try:
        response = requests.post(
            HOTEL_SEARCH_URL,
            json=request_body,
            headers=headers,
            timeout=30
        )
        
        logger.info(f"Response Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            hotels = data.get("data", data.get("hotels", []))
            logger.success(f"Found {len(hotels)} hotels!")
            return data
        else:
            # Check for known server-side bug
            if "UnboundLocalError" in response.text:
                logger.warning("API is experiencing server-side issues (known bug)")
                logger.warning("The AwardTool Hotel API has a Lambda handler bug.")
                logger.warning("Please try again later or contact AwardTool support.")
            else:
                logger.error(f"Request failed: {response.status_code}")
                logger.error(f"Response: {response.text[:500]}")
            
            return {
                "error": True,
                "status_code": response.status_code,
                "message": response.text[:500],
                "api_status": "server_error"
            }
            
    except requests.exceptions.Timeout:
        logger.error("Request timed out after 30 seconds")
        return {"error": True, "message": "Timeout"}
    except requests.exceptions.RequestException as e:
        logger.error(f"Request failed: {e}")
        return {"error": True, "message": str(e)}


def generate_sample_data():
    """
    Generate sample hotel data for demonstration when API is unavailable.
    
    This shows the expected response format from the API.
    """
    logger.info("\nGenerating sample data (API unavailable)...")
    
    # Calculate nights
    check_in = datetime.strptime(request_body["check_in"], "%Y-%m-%d")
    check_out = datetime.strptime(request_body["check_out"], "%Y-%m-%d")
    nights = (check_out - check_in).days
    
    # Sample data showing expected format
    sample_hotels = [
        {
            "hotel_id": "sample_1",
            "name": "Hilton London Tower Bridge",
            "brand": "Hilton",
            "program_code": "HH",
            "cash_rate": 289.00,
            "points": 60000,
            "surcharge": 45.00,
            "star_rating": 4,
            "address": "5 More London Place, London SE1 2BY"
        },
        {
            "hotel_id": "sample_2", 
            "name": "London Marriott Hotel Park Lane",
            "brand": "Marriott",
            "program_code": "MAR",
            "cash_rate": 450.00,
            "points": 70000,
            "surcharge": 55.00,
            "star_rating": 5,
            "address": "140 Park Lane, London W1K 7AA"
        },
        {
            "hotel_id": "sample_3",
            "name": "Hyatt Regency London - The Churchill",
            "brand": "Hyatt",
            "program_code": "HYATT",
            "cash_rate": 375.00,
            "points": 25000,
            "surcharge": 40.00,
            "star_rating": 5,
            "address": "30 Portman Square, London W1H 7BH"
        },
        {
            "hotel_id": "sample_4",
            "name": "InterContinental London Park Lane",
            "brand": "IHG",
            "program_code": "IHG",
            "cash_rate": 420.00,
            "points": 55000,
            "surcharge": 50.00,
            "star_rating": 5,
            "address": "One Hamilton Place, London W1J 7QY"
        },
    ]
    
    return {
        "data": sample_hotels,
        "sample_data": True,
        "note": "This is sample data. API is currently unavailable."
    }


def parse_and_display_results(data):
    """
    Parse and display hotel search results.
    """
    if not data:
        return
    
    if data.get("error"):
        logger.warning("API returned an error. Using sample data for demonstration.")
        data = generate_sample_data()
    
    hotels = data.get("data", data.get("hotels", []))
    
    if not hotels:
        logger.warning("No hotels returned")
        return
    
    # Calculate nights
    check_in = datetime.strptime(request_body["check_in"], "%Y-%m-%d")
    check_out = datetime.strptime(request_body["check_out"], "%Y-%m-%d")
    nights = (check_out - check_in).days
    
    is_sample = data.get("sample_data", False)
    
    logger.info("=" * 60)
    logger.info(f"Hotel Results ({nights} nights){' [SAMPLE DATA]' if is_sample else ''}")
    logger.info("=" * 60)
    
    for i, hotel in enumerate(hotels[:10], 1):
        name = hotel.get("name") or hotel.get("hotel_name", "Unknown")
        program = hotel.get("program_code") or hotel.get("program", "")
        brand = hotel.get("brand", "")
        stars = hotel.get("star_rating") or hotel.get("stars", "N/A")
        address = hotel.get("address", "")
        
        # Points per night
        points = hotel.get("points") or hotel.get("award_points") or hotel.get("points_required")
        # Cash rate per night
        cash = hotel.get("cash_rate") or hotel.get("cash_cost") or hotel.get("price")
        # Taxes/fees
        surcharge = hotel.get("surcharge") or hotel.get("tax", 0)
        
        logger.info(f"\n{i}. {name}")
        logger.info(f"   Brand: {brand} ({program}) | Stars: {stars}")
        if address:
            logger.info(f"   Address: {address}")
        if points:
            total_pts = int(points * nights)
            logger.info(f"   Points: {int(points):,}/night ({total_pts:,} total)")
        if cash:
            total_cash = cash * nights
            logger.info(f"   Cash: ${cash:.2f}/night (${total_cash:.2f} total)")
        if surcharge:
            logger.info(f"   Taxes/Fees: ${surcharge:.2f}")
        
        # Calculate CPP if both available
        if points and cash:
            cpp = (cash / points) * 100
            logger.info(f"   CPP Value: {cpp:.2f}¢ per point")
    
    # Save to file
    output_file = "hotel_results.json"
    with open(output_file, "w") as f:
        json.dump(data, f, indent=2)
    logger.info(f"\nSaved results to: {output_file}")


if __name__ == "__main__":
    data = search_hotels()
    parse_and_display_results(data)
