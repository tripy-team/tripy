# AwardTool Hotel API - award and cash hotel search
# API docs: https://documenter.getpostman.com/view/31698313/2sB2iwGF3n
# Supports: Hilton (HH), IHG (IHG), Marriott (MAR/Bonvoy), Hyatt (HYATT)

import asyncio
import logging
import os
import re
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import httpx
from dotenv import load_dotenv

from src.utils.cache_layer import get_json, set_json
from src.config import is_awardtool_dummy_mode

load_dotenv()

logger = logging.getLogger(__name__)

# Support both naming conventions (AWARD_TOOL vs AWARDTOOL, per apprunner)
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
HOTEL_SEARCH_URL = "https://www.awardtool-api.com/search_hotel"
HOTEL_CALENDAR_URL = "https://www.awardtool-api.com/api/hotel_calendar"

# Default hotel programs if none provided (AwardTool: Hilton, IHG, Marriott, Hyatt)
DEFAULT_HOTEL_PROGRAMS = ["HH", "IHG", "MAR", "HYATT"]

TIMEOUT = httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=20)
TIMEOUT_CALENDAR = httpx.Timeout(connect=5.0, read=30.0, write=5.0, pool=20)  # Calendar API needs longer timeout


def _key_hotel(dest: str, checkin: str, checkout: str, programs: List[str], guests: int, hotel_class: Optional[str]) -> str:
    pj = ",".join(sorted([p.upper() for p in programs])) if programs else "default"
    star = str(hotel_class or "").strip() or "any"
    return f"hotel:{dest}:{checkin}:{checkout}:{pj}:{guests}:{star}"


TTL_HOTEL = 6 * 3600  # 6h


def _to_number(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if not s:
        return None
    # strip currency symbols and commas
    m = re.search(r"(\d[\d,.]*)", s)
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except Exception:
        return None


async def _http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(
        http2=True,
        headers={"User-Agent": "Tripy/1.0 (+https://tripy.app)", "Content-Type": "application/json"},
    )


async def _awardtool_hotel_search(
    destination: str,
    check_in: str,
    check_out: str,
    programs: List[str],
    guests: int,
    hotel_class: Optional[str],
    client: httpx.AsyncClient,
) -> Dict[str, Any]:
    # Check if dummy mode is enabled
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_hotel_data
        logger.info("[DUMMY MODE] Returning dummy hotel data for %s (%s to %s)", destination, check_in, check_out)
        return generate_dummy_hotel_data(destination, check_in, check_out, programs, guests, hotel_class)
    
    if not AWARD_TOOL_API_KEY:
        logger.warning("AWARD_TOOL_API_KEY not set; AwardTool hotel request for destination=%s may fail", destination)

    progs = [p.upper() for p in (programs or DEFAULT_HOTEL_PROGRAMS)]
    k = _key_hotel(destination, check_in, check_out, progs, guests, hotel_class)
    cached = get_json(k)
    if cached:
        logger.debug("AwardTool hotel [%s] %s-%s: cache hit", destination, check_in, check_out)
        return cached

    payload: Dict[str, Any] = {
        "destination": destination.strip(),
        "check_in": check_in,
        "check_out": check_out,
        "programs": progs,
        "guests": int(guests) if guests else 1,
        "api_key": AWARD_TOOL_API_KEY,
    }
    if hotel_class and str(hotel_class).strip():
        payload["hotel_class"] = str(hotel_class).strip()  # e.g. "3","4","5" for star rating

    logger.info(
        "AwardTool hotel [%s] %s-%s: requesting (programs=%s, guests=%s)",
        destination, check_in, check_out, len(progs), payload["guests"],
    )
    try:
        r = await client.post(HOTEL_SEARCH_URL, json=payload, timeout=TIMEOUT)
        r.raise_for_status()
        body = r.json()
    except httpx.HTTPStatusError as e:
        err_body = (e.response.text or "")[:500]
        logger.warning(
            "AwardTool hotel [%s] %s-%s: HTTP %s, body=%s",
            destination, check_in, check_out, e.response.status_code, err_body,
        )
        raise
    except Exception as e:
        logger.warning("AwardTool hotel [%s] %s-%s: %s", destination, check_in, check_out, e)
        raise

    data = body.get("data", body.get("hotels", [])) if isinstance(body, dict) else []
    err = body.get("error") or body.get("message") if isinstance(body, dict) else None
    count = len(data) if isinstance(data, list) else 0
    logger.info(
        "AwardTool hotel [%s] %s-%s: data_items=%d%s",
        destination, check_in, check_out, count, f", error={err}" if err else "",
    )
    set_json(k, body, TTL_HOTEL)
    return body


def _parse_hotel_results(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Normalize AwardTool hotel response into a list of:
    { hotel_id, name, brand, program_code, cash_cost, points_cost, surcharge, star_rating, address, raw }
    """
    out: List[Dict[str, Any]] = []
    data = body.get("data", body.get("hotels", []))
    if not isinstance(data, list):
        return out

    for i, item in enumerate(data):
        if not isinstance(item, dict):
            continue
        hid = item.get("hotel_id") or item.get("id") or item.get("hotelId") or f"h{i}"
        name = item.get("name") or item.get("hotel_name") or ""
        brand = (item.get("brand") or item.get("program_code") or "").strip()
        prog = (item.get("program_code") or item.get("program") or brand or "").strip().upper()
        cash = _to_number(item.get("cash_rate") or item.get("cash_cost") or item.get("price"))
        pts = _to_number(item.get("points") or item.get("award_points") or item.get("points_required"))
        sur = _to_number(item.get("surcharge") or item.get("tax"))
        stars = item.get("star_rating") or item.get("stars") or item.get("hotel_class")
        addr = item.get("address") or item.get("location") or ""

        out.append({
            "hotel_id": str(hid),
            "name": name or f"Hotel {hid}",
            "brand": brand or prog or "Unknown",
            "program_code": prog or None,
            "cash_cost": cash,
            "points_cost": int(pts) if pts is not None and pts == int(pts) else pts,
            "surcharge": sur,
            "star_rating": stars,
            "address": addr,
            "raw": item,
        })
    return out


async def search_hotels_async(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 1,
    hotel_class: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> List[Dict[str, Any]]:
    """
    Search AwardTool Hotel API for award and cash rates.
    Returns normalized list of { hotel_id, name, brand, program_code, cash_cost, points_cost, surcharge, star_rating, address, raw }.
    """
    own_client = client is None
    if client is None:
        client = await _http_client()
    try:
        body = await _awardtool_hotel_search(
            destination=destination,
            check_in=check_in,
            check_out=check_out,
            programs=programs or DEFAULT_HOTEL_PROGRAMS,
            guests=guests,
            hotel_class=hotel_class,
            client=client,
        )
        return _parse_hotel_results(body)
    finally:
        if own_client:
            await client.aclose()


def search_hotels(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 1,
    hotel_class: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """Synchronous wrapper for search_hotels_async."""
    return asyncio.run(
        search_hotels_async(destination, check_in, check_out, programs, guests, hotel_class)
    )


# ===========================================================================
# AGENT-COMPATIBLE WRAPPER FUNCTIONS
# ===========================================================================

async def search_awardtool_hotels(
    city: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    star_ratings: Optional[List[int]] = None,
    guests: int = 1,
) -> List[Dict[str, Any]]:
    """
    Search for award hotels using AwardTool API.
    
    This is the agent-compatible wrapper around _awardtool_hotel_search.
    Returns a list of normalized hotel options.
    
    Args:
        city: City name or destination
        check_in: Check-in date YYYY-MM-DD
        check_out: Check-out date YYYY-MM-DD
        programs: List of hotel programs (e.g., ["HH", "MAR", "HYATT"])
        star_ratings: List of star ratings to filter (e.g., [4, 5])
        guests: Number of guests
        
    Returns:
        List of hotel options with standardized fields:
        - name, brand, star_rating, cash_rate, cash_total
        - program, points_per_night, points_total, surcharge, available
    """
    programs = programs or DEFAULT_HOTEL_PROGRAMS
    
    # Convert star_ratings to hotel_class parameter
    hotel_class = None
    if star_ratings and len(star_ratings) == 1:
        hotel_class = str(star_ratings[0])
    
    client = await _http_client()
    try:
        raw_result = await _awardtool_hotel_search(
            destination=city,
            check_in=check_in,
            check_out=check_out,
            programs=programs,
            guests=guests,
            hotel_class=hotel_class,
            client=client,
        )
        
        # Parse results
        parsed = _parse_hotel_results(raw_result)
        
        # Calculate nights
        from datetime import datetime
        try:
            ci = datetime.strptime(check_in, "%Y-%m-%d")
            co = datetime.strptime(check_out, "%Y-%m-%d")
            nights = (co - ci).days
        except:
            nights = 1
        
        # Normalize for agent
        results = []
        for item in parsed:
            # Filter by star rating if specified
            star = item.get("star_rating")
            if star_ratings and star:
                try:
                    if int(star) not in star_ratings:
                        continue
                except:
                    pass
            
            cash_per_night = item.get("cash_cost")
            points_per_night = item.get("points_cost")
            
            results.append({
                "name": item.get("name"),
                "brand": item.get("brand"),
                "star_rating": star,
                "program": item.get("program_code"),
                "cash_rate": cash_per_night,
                "cash_total": cash_per_night * nights if cash_per_night else None,
                "points_per_night": int(points_per_night) if points_per_night else None,
                "points_total": int(points_per_night * nights) if points_per_night else None,
                "surcharge": item.get("surcharge") or 0,
                "available": points_per_night is not None,
                "address": item.get("address"),
            })
        
        logger.info(f"search_awardtool_hotels: {city} ({check_in} to {check_out}): {len(results)} options")
        return results
        
    finally:
        await client.aclose()


# ===========================================================================
# HOTEL CALENDAR API - Get availability calendar for specific hotels
# ===========================================================================

def _key_hotel_calendar(hotel_id: str, date: str) -> str:
    """Cache key for hotel calendar data."""
    return f"hotel_cal:{hotel_id}:{date}"


TTL_HOTEL_CALENDAR = 4 * 3600  # 4h - calendar data changes less frequently


async def _awardtool_hotel_calendar(
    hotel_id: str,
    date: str,
    client: httpx.AsyncClient,
) -> Dict[str, Any]:
    """
    Fetch hotel calendar data from AwardTool API.
    
    The hotel_calendar endpoint returns availability and pricing for a specific hotel
    across a range of dates (typically 365 days from the provided date).
    
    Args:
        hotel_id: AwardTool hotel ID (e.g., "hyatt_madel" for Hyatt Madeleine Paris)
        date: Reference date for calendar YYYY-MM-DD
        client: HTTP client
        
    Returns:
        Dict with 'data' containing date-keyed availability
    """
    # Check cache first
    k = _key_hotel_calendar(hotel_id, date)
    cached = get_json(k)
    if cached:
        logger.debug("Hotel calendar [%s] date=%s: cache hit", hotel_id, date)
        return cached

    if not AWARD_TOOL_API_KEY:
        logger.warning("AWARD_TOOL_API_KEY not set; hotel calendar request may fail")
        return {"error": "API key not configured"}

    payload = {
        "hotel_id": hotel_id,
        "date": date,
        "api_key": AWARD_TOOL_API_KEY,
    }

    logger.info("Hotel calendar [%s] date=%s: requesting", hotel_id, date)
    
    try:
        r = await client.post(HOTEL_CALENDAR_URL, json=payload, timeout=TIMEOUT_CALENDAR)
        r.raise_for_status()
        body = r.json()
    except httpx.HTTPStatusError as e:
        err_body = (e.response.text or "")[:500]
        logger.warning(
            "Hotel calendar [%s] date=%s: HTTP %s, body=%s",
            hotel_id, date, e.response.status_code, err_body,
        )
        return {"error": f"HTTP {e.response.status_code}", "details": err_body}
    except Exception as e:
        logger.warning("Hotel calendar [%s] date=%s: %s", hotel_id, date, e)
        return {"error": str(e)}

    data = body.get("data", [])
    count = 0
    if isinstance(data, list) and data:
        # Count total dates across all date-keyed objects
        for item in data:
            if isinstance(item, dict):
                count += len(item.keys())
    
    logger.info("Hotel calendar [%s] date=%s: %d date entries", hotel_id, date, count)
    set_json(k, body, TTL_HOTEL_CALENDAR)
    return body


def _parse_hotel_calendar_results(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """
    Parse hotel calendar response into a flat list of availability records.
    
    Input format (from API):
    {
        "data": [
            {
                "2026-01-28": [{
                    "avail_date": "2026-01-28",
                    "cash_price": "752",
                    "points_rate": 30000,
                    "point_value": "2.51",
                    "rate_plan": "Standard Room",
                    "room_type": "1 Queen Bed",
                    "res_link": "https://..."
                }],
                ...
            }
        ]
    }
    
    Output: Flat list of records with normalized fields
    """
    out: List[Dict[str, Any]] = []
    data = body.get("data", [])
    
    if not isinstance(data, list):
        return out
    
    for date_block in data:
        if not isinstance(date_block, dict):
            continue
        
        for date_str, rooms in date_block.items():
            if not isinstance(rooms, list):
                continue
            
            for room in rooms:
                if not isinstance(room, dict):
                    continue
                
                cash_price = _to_number(room.get("cash_price"))
                points_rate = _to_number(room.get("points_rate"))
                point_value = _to_number(room.get("point_value"))
                
                out.append({
                    "date": room.get("avail_date") or date_str,
                    "cash_price": cash_price,
                    "points_rate": int(points_rate) if points_rate else None,
                    "point_value_cpp": point_value,  # Cents per point
                    "rate_plan": room.get("rate_plan"),
                    "room_type": room.get("room_type"),
                    "booking_link": room.get("res_link"),
                    "created_at": room.get("created_at"),
                })
    
    return out


async def get_hotel_calendar_async(
    hotel_id: str,
    check_in: Optional[str] = None,
    check_out: Optional[str] = None,
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """
    Get hotel availability calendar for a specific property.
    
    Args:
        hotel_id: AwardTool hotel ID (e.g., "hyatt_madel", "marriott_lonpk")
        check_in: Optional check-in date to filter results (YYYY-MM-DD)
        check_out: Optional check-out date to filter results (YYYY-MM-DD)
        client: Optional HTTP client
        
    Returns:
        Dict with:
        - hotel_id: The queried hotel
        - availability: List of date availability records
        - best_dates: Top dates by points value (if available)
        - summary: Stats about the availability
    """
    own_client = client is None
    if client is None:
        client = httpx.AsyncClient(
            http2=True,
            headers={"User-Agent": "Tripy/1.0", "Content-Type": "application/json"},
        )
    
    try:
        # Use check_in as reference date, or today
        ref_date = check_in or datetime.now().strftime("%Y-%m-%d")
        
        body = await _awardtool_hotel_calendar(hotel_id, ref_date, client)
        
        if body.get("error"):
            return {
                "hotel_id": hotel_id,
                "error": body.get("error"),
                "details": body.get("details"),
            }
        
        # Parse all availability records
        all_records = _parse_hotel_calendar_results(body)
        
        # Filter by date range if specified
        if check_in or check_out:
            filtered = []
            for rec in all_records:
                rec_date = rec.get("date", "")
                if check_in and rec_date < check_in:
                    continue
                if check_out and rec_date >= check_out:
                    continue
                filtered.append(rec)
            records = filtered
        else:
            records = all_records
        
        # Sort by date
        records.sort(key=lambda x: x.get("date", ""))
        
        # Find best dates by points value (CPP)
        best_by_value = sorted(
            [r for r in records if r.get("point_value_cpp")],
            key=lambda x: x.get("point_value_cpp", 0),
            reverse=True
        )[:5]
        
        # Find cheapest points dates
        cheapest_points = sorted(
            [r for r in records if r.get("points_rate")],
            key=lambda x: x.get("points_rate", float("inf"))
        )[:5]
        
        # Summary stats
        cash_prices = [r["cash_price"] for r in records if r.get("cash_price")]
        points_rates = [r["points_rate"] for r in records if r.get("points_rate")]
        cpp_values = [r["point_value_cpp"] for r in records if r.get("point_value_cpp")]
        
        summary = {
            "total_dates": len(records),
            "date_range": {
                "start": records[0]["date"] if records else None,
                "end": records[-1]["date"] if records else None,
            },
            "cash_price": {
                "min": min(cash_prices) if cash_prices else None,
                "max": max(cash_prices) if cash_prices else None,
                "avg": sum(cash_prices) / len(cash_prices) if cash_prices else None,
            },
            "points_rate": {
                "min": min(points_rates) if points_rates else None,
                "max": max(points_rates) if points_rates else None,
                "most_common": max(set(points_rates), key=points_rates.count) if points_rates else None,
            },
            "cpp_value": {
                "min": min(cpp_values) if cpp_values else None,
                "max": max(cpp_values) if cpp_values else None,
                "avg": sum(cpp_values) / len(cpp_values) if cpp_values else None,
            },
        }
        
        return {
            "hotel_id": hotel_id,
            "availability": records,
            "best_value_dates": best_by_value,
            "cheapest_points_dates": cheapest_points,
            "summary": summary,
        }
        
    finally:
        if own_client:
            await client.aclose()


def get_hotel_calendar(
    hotel_id: str,
    check_in: Optional[str] = None,
    check_out: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronous wrapper for get_hotel_calendar_async."""
    return asyncio.run(get_hotel_calendar_async(hotel_id, check_in, check_out))


# ===========================================================================
# ===========================================================================
# HOTEL SEARCH WITH CALENDAR DATA
# ===========================================================================


async def search_hotels_with_calendar(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 1,
    hotel_class: Optional[str] = None,
    top_hotels: int = 5,
) -> Dict[str, Any]:
    """
    Search for hotels using calendar data for known hotels.
    
    Strategy:
    1. Try the search_hotel endpoint (may have server issues)
    2. If that fails, use known hotels by city with calendar data
    3. Return enriched results with accurate pricing for exact dates
    
    Args:
        destination: City or destination name
        check_in: Check-in date YYYY-MM-DD
        check_out: Check-out date YYYY-MM-DD
        programs: Hotel programs (HH, IHG, MAR, HYATT)
        guests: Number of guests
        hotel_class: Star rating filter
        top_hotels: Number of hotels to return
        
    Returns:
        Dict with hotels, calendar data, and recommendations
    """
    client = httpx.AsyncClient(
        http2=True,
        headers={"User-Agent": "Tripy/1.0", "Content-Type": "application/json"},
    )
    
    try:
        search_results = []
        search_error = None
        
        # Try the search_hotel endpoint
        try:
            search_results = await search_hotels_async(
                destination=destination,
                check_in=check_in,
                check_out=check_out,
                programs=programs,
                guests=guests,
                hotel_class=hotel_class,
                client=client,
            )
        except Exception as e:
            search_error = str(e)
            logger.warning(f"Hotel search failed: {e}")
        
        if not search_results:
            return {
                "destination": destination,
                "check_in": check_in,
                "check_out": check_out,
                "hotels": [],
                "calendar_enriched": [],
                "error": search_error or f"No hotels found for {destination}",
            }
        
        # 3. Get calendar data for hotels
        enriched_hotels = []
        for hotel in search_results[:top_hotels]:
            hotel_id = hotel.get("hotel_id")
            if not hotel_id:
                enriched_hotels.append({**hotel, "calendar_data": None})
                continue
            
            try:
                calendar = await get_hotel_calendar_async(
                    hotel_id=hotel_id,
                    check_in=check_in,
                    check_out=check_out,
                    client=client,
                )
                
                if not calendar.get("error"):
                    availability = calendar.get("availability", [])
                    if availability:
                        # Calculate totals for the stay
                        total_points = sum(r.get("points_rate", 0) or 0 for r in availability)
                        total_cash = sum(r.get("cash_price", 0) or 0 for r in availability)
                        avg_cpp = sum(r.get("point_value_cpp", 0) or 0 for r in availability) / len(availability) if availability else 0
                        
                        enriched_hotels.append({
                            **hotel,
                            "calendar_data": {
                                "nights": len(availability),
                                "total_points": total_points,
                                "total_cash": total_cash,
                                "avg_cpp": round(avg_cpp, 2),
                                "daily_rates": availability,
                                "summary": calendar.get("summary"),
                            }
                        })
                    else:
                        logger.debug(f"No availability for {hotel_id} on {check_in} to {check_out}")
                        enriched_hotels.append({**hotel, "calendar_data": None})
                else:
                    logger.debug(f"Calendar error for {hotel_id}: {calendar.get('error')}")
                    enriched_hotels.append({**hotel, "calendar_data": None})
            except Exception as e:
                logger.warning(f"Failed to get calendar for {hotel_id}: {e}")
                enriched_hotels.append({**hotel, "calendar_data": None})
        
        # 4. Find best options
        # Best by points (lowest total)
        with_points = [h for h in enriched_hotels if h.get("calendar_data") and h["calendar_data"].get("total_points")]
        best_by_points = min(with_points, key=lambda x: x["calendar_data"]["total_points"]) if with_points else None
        
        # Best by CPP value (highest)
        with_cpp = [h for h in enriched_hotels if h.get("calendar_data") and h["calendar_data"].get("avg_cpp")]
        best_by_value = max(with_cpp, key=lambda x: x["calendar_data"]["avg_cpp"]) if with_cpp else None
        
        # Best by cash (lowest)
        with_cash = [h for h in enriched_hotels if h.get("calendar_data") and h["calendar_data"].get("total_cash")]
        best_by_cash = min(with_cash, key=lambda x: x["calendar_data"]["total_cash"]) if with_cash else None
        
        try:
            nights = (datetime.strptime(check_out, "%Y-%m-%d") - datetime.strptime(check_in, "%Y-%m-%d")).days
        except:
            nights = None
        
        return {
            "destination": destination,
            "check_in": check_in,
            "check_out": check_out,
            "nights": nights,
            "hotels_searched": len(search_results),
            "calendar_enriched": enriched_hotels,
            "recommendations": {
                "best_by_points": best_by_points,
                "best_by_value": best_by_value,
                "best_by_cash": best_by_cash,
            },
            "search_error": search_error,
        }
        
    finally:
        await client.aclose()


async def get_best_hotel_nights(
    hotel_id: str,
    num_nights: int,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    optimize_for: str = "points",  # "points" or "cpp" or "cash"
    client: Optional[httpx.AsyncClient] = None,
) -> Dict[str, Any]:
    """
    Find the best consecutive nights for a hotel stay.
    
    Args:
        hotel_id: AwardTool hotel ID
        num_nights: Number of nights needed
        start_date: Earliest possible check-in (YYYY-MM-DD)
        end_date: Latest possible check-out (YYYY-MM-DD)
        optimize_for: "points" (minimize points), "cpp" (maximize value), "cash" (minimize cash)
        client: Optional HTTP client
        
    Returns:
        Dict with best_stay options ranked by the optimization criteria
    """
    calendar = await get_hotel_calendar_async(
        hotel_id=hotel_id,
        check_in=start_date,
        check_out=end_date,
        client=client,
    )
    
    if calendar.get("error"):
        return calendar
    
    records = calendar.get("availability", [])
    if len(records) < num_nights:
        return {
            "hotel_id": hotel_id,
            "error": f"Not enough availability. Found {len(records)} dates, need {num_nights}",
        }
    
    # Build date-to-record lookup
    by_date = {r["date"]: r for r in records if r.get("date")}
    
    # Find all possible consecutive sequences
    sequences = []
    dates = sorted(by_date.keys())
    
    for i, start in enumerate(dates):
        if i + num_nights > len(dates):
            break
        
        # Check if we have consecutive nights
        try:
            start_dt = datetime.strptime(start, "%Y-%m-%d")
            nights = []
            valid = True
            
            for n in range(num_nights):
                check_date = (start_dt + timedelta(days=n)).strftime("%Y-%m-%d")
                if check_date in by_date:
                    nights.append(by_date[check_date])
                else:
                    valid = False
                    break
            
            if valid and len(nights) == num_nights:
                total_points = sum(n.get("points_rate", 0) or 0 for n in nights)
                total_cash = sum(n.get("cash_price", 0) or 0 for n in nights)
                avg_cpp = sum(n.get("point_value_cpp", 0) or 0 for n in nights) / num_nights if nights else 0
                
                checkout_date = (start_dt + timedelta(days=num_nights)).strftime("%Y-%m-%d")
                
                sequences.append({
                    "check_in": start,
                    "check_out": checkout_date,
                    "nights": num_nights,
                    "total_points": total_points,
                    "total_cash": total_cash,
                    "avg_cpp": round(avg_cpp, 2),
                    "rooms": nights,
                })
        except ValueError:
            continue
    
    # Sort by optimization criteria
    if optimize_for == "points":
        sequences.sort(key=lambda x: x.get("total_points", float("inf")))
    elif optimize_for == "cpp":
        sequences.sort(key=lambda x: x.get("avg_cpp", 0), reverse=True)
    elif optimize_for == "cash":
        sequences.sort(key=lambda x: x.get("total_cash", float("inf")))
    
    return {
        "hotel_id": hotel_id,
        "num_nights": num_nights,
        "optimize_for": optimize_for,
        "options_found": len(sequences),
        "best_stays": sequences[:10],  # Top 10 options
        "summary": calendar.get("summary"),
    }
