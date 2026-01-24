# backend/flights.py  (fast path: Panorama prune → single RT AwardTool → single SERP route)
import os, re, json, math, asyncio
import httpx
from dotenv import load_dotenv
from src.utils.cache_layer import get_json, set_json
from src.data.award_programs import get_award_programs_for_api
from .award_calendar import (
    get_calendar_matrix,
    best_dates_by_cabin,
)

# Keep your existing helpers if you have them:
# from serp_client import search as serp_search, collect_items, pick_cheapest
# from time_utils import extract_hour, hour_bucket, to_minutes
# from airport_filter import is_commercial_airport
# from amadeus import Client as AmadeusClient, Location

load_dotenv()
SERPAPI_KEY = os.getenv("SERPAPI_KEY")
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY")

# ==== HTTP clients ====
TIMEOUT = httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=20)


def _normalize_flightnum(x):
    return re.sub(r"\s+", "", str(x or "").strip().upper())


def _to_number_price(v):
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.search(r"(\d[\d,\.]*)", str(v))
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except Exception:
        return None


def _normalize_cabin_for_award_api(travel_class):
    if not travel_class:
        return ["Economy", "Premium Economy", "Business", "First"]
    m = str(travel_class).strip().lower()
    if m in ("economy", "coach", "main", "main_cabin"):
        return ["Economy"]
    if m in ("premium", "premium_economy", "premeco", "prem"):
        return ["Premium Economy"]
    if m in ("business", "biz", "j"):
        return ["Business"]
    if m in ("first", "f"):
        return ["First"]
    return ["Economy", "Premium Economy", "Business", "First"]


def _normalize_travel_class_for_serp(value):
    if value is None:
        return None
    if isinstance(value, (list, tuple)) and value:
        value = value[0]
    try:
        iv = int(value)
        return iv if iv in (1, 2, 3, 4) else None
    except Exception:
        pass
    s = str(value).strip().lower().replace(" ", "_")
    return {"economy": 1, "premium_economy": 2, "business": 3, "first": 4}.get(s)


async def _http_client():
    return httpx.AsyncClient(
        http2=True, headers={"User-Agent": "Tripy/1.0 (+https://tripy.app)"}
    )


# ==== Caching keys & TTLs ====
def key_award(o, d, date, cabins, pax, programs):
    pj = ",".join(sorted([p.upper() for p in programs]))
    cj = ",".join(cabins)
    return f"award:{o}:{d}:{date}:{cj}:{pax}:{pj}"


def key_pan(o, d):
    return f"pan:{o}:{d}"


def key_serp(o, d, date, tclass, stops, bags):
    return f"serp:{o}:{d}:{date}:{tclass}:{stops}:{bags}"


TTL_AWARD = 6 * 3600  # 6h
TTL_PAN = 24 * 3600  # 24h
TTL_SERP = 90 * 60  # 90m


# ==== SERP route-level (single call) ====
async def serp_route(origin, destination, date_str, filters, client):
    tclass = _normalize_travel_class_for_serp((filters or {}).get("travel_class"))
    params = {
        "engine": "google_flights",
        "api_key": SERPAPI_KEY,
        "type": 2,
        "currency": "USD",
        "deep_search": True,
        "departure_id": origin,
        "arrival_id": destination,
        "outbound_date": date_str,
        "travel_class": tclass,
    }
    if (filters or {}).get("stops") is not None:
        params["stops"] = filters["stops"]
    if (filters or {}).get("bags") is not None:
        params["bags"] = filters["bags"]
    if (filters or {}).get("include_airlines"):
        params["include_airlines"] = filters["include_airlines"]
    if (filters or {}).get("exclude_airlines"):
        params["exclude_airlines"] = filters["exclude_airlines"]
    if (filters or {}).get("max_price") is not None:
        params["max_price"] = filters["max_price"]

    k = key_serp(
        origin, destination, date_str, tclass, params.get("stops"), params.get("bags")
    )
    cached = get_json(k)
    if cached:
        return cached

    r = await client.get(
        "https://serpapi.com/search.json", params=params, timeout=TIMEOUT
    )
    r.raise_for_status()
    body = r.json()
    set_json(k, body, TTL_SERP)
    return body


def serp_route_to_leg_map(route_json):
    """
    Collects best cash per (dep,arr,flight_num) from SERP route.
    Handles multistop flights by extracting all individual legs from each route.
    Supports small airports - extracts all connecting segments (e.g., ITH -> JFK -> CDG).
    """
    by_leg = {}
    # Process both best_flights and other_flights to get comprehensive coverage
    all_flight_options = (route_json.get("best_flights") or []) + (
        route_json.get("other_flights") or []
    )
    
    for it in all_flight_options:
        price = _to_number_price(it.get("price"))
        flights = it.get("flights") or []
        
        # For multistop flights, extract each leg separately
        # Example: ITH -> JFK -> CDG becomes two legs: (ITH, JFK) and (JFK, CDG)
        for leg in flights:
            dep = leg.get("departure_airport", {}).get("id")
            arr = leg.get("arrival_airport", {}).get("id")
            fn = _normalize_flightnum(leg.get("flight_number"))
            dur = leg.get("duration_in_minutes") or leg.get("durationMinutes")
            
            if dur is None:
                txt = leg.get("duration") or ""
                # if you have to_minutes, use it here; else keep None
                # dur = to_minutes(txt) if txt else None
            
            # Skip if missing required fields
            if not dep or not arr or not fn:
                continue
            
            # Use (dep, arr, fn) as key to uniquely identify each leg
            # For multistop flights, this allows us to capture each segment
            prev = by_leg.get((dep, arr, fn))
            if prev is None or (
                price is not None
                and (prev.get("cash_cost") is None or price < prev["cash_cost"])
            ):
                by_leg[(dep, arr, fn)] = {
                    "cash_cost": price,
                    "time_cost": dur,
                    "departure_time": leg.get("departure_airport", {}).get("time"),
                    "arrival_time": leg.get("arrival_airport", {}).get("time"),
                }
    
    return by_leg


# ==== AwardTool (Panorama prune → single multi-program realtime) ====
async def _awardtool_realtime(
    origin, destination, date_str, cabins, pax, programs, client
):
    k = key_award(origin, destination, date_str, cabins, pax, programs)
    cached = get_json(k)
    if cached:
        return cached

    payload = {
        "origin": origin,
        "destination": destination,
        "programs": [p.upper() for p in programs],
        "cabins": cabins,
        "date": date_str,
        "pax": str(pax),
        "api_key": AWARD_TOOL_API_KEY,
    }
    r = await client.post(
        "https://www.awardtool-api.com/search_real_time", json=payload, timeout=TIMEOUT
    )
    r.raise_for_status()
    body = r.json()
    set_json(k, body, TTL_AWARD)
    return body


def _merge_award_edges(rt_json):
    # Returns dict (dep,arr,fn)-> award fields (cheapest per flight)
    data = rt_json.get("data", []) if isinstance(rt_json, dict) else []
    by_edge = {}
    for item in data:
        fare = item.get("fare") or {}
        products = fare.get("products") or []
        pts = item.get("award_points")
        sur = item.get("surcharge")
        prog = (item.get("program_code") or item.get("airline_code") or "").upper()
        xfer = (
            item.get("transfer_options") or []
        )  # [{program, points}, ...] when present
        for p in products:
            dep = (p.get("origin") or "").upper()
            arr = (p.get("destination") or "").upper()
            fn = _normalize_flightnum(p.get("flight_number"))
            if not dep or not arr or not fn or pts is None:
                continue
            travel_minutes = p.get("travel_minutes") or fare.get("travel_minutes_total")
            dep_time = p.get("departure_time")
            arr_time = p.get("arrival_time")
            key = (dep, arr, fn)
            prev = by_edge.get(key)
            if (prev is None) or (pts < prev["award_points"]):
                by_edge[key] = {
                    "award_points": int(pts),
                    "program_code": prog,
                    "surcharge": float(sur) if isinstance(sur, (int, float)) else None,
                    "transfer_partners": xfer,
                    "travel_minutes": travel_minutes,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                }
    return by_edge


async def _panorama_top_dates(origin, destination, cabin, top_k, client):
    k = key_pan(origin, destination)
    cached = get_json(k)
    if cached is None:
        mat = await get_calendar_matrix(origin, destination, client=client)
        set_json(k, mat, TTL_PAN)
    else:
        mat = cached
    return best_dates_by_cabin(mat, cabin, top_k=top_k, require_available=True)


# ==== Public APIs ====
async def get_flights_award_first_with_points_async(
    origin,
    destination,
    user_points,
    filters=None,
    award_programs=None,
    panorama_top_k=2,
):
    filt = dict(filters or {})
    date_str = filt.get("outbound_date", "2025-10-18")
    pax = int(filt.get("pax") or 1)
    cabins = _normalize_cabin_for_award_api(filt.get("travel_class"))
    cabin_for_pan = (
        (cabins[0] or "Economy").lower().replace(" ", "_")
    )  # pick user's main
    programs = (
        award_programs
        or filt.get("award_programs")
        or get_award_programs_for_api()
    )

    client = await _http_client()
    try:
        # Optionally use Panorama to validate date; if that date not “good”, pull top-K and include current date too
        try:
            top_dates = await _panorama_top_dates(
                origin, destination, cabin_for_pan, panorama_top_k, client
            )
        except Exception:
            top_dates = []
        dates = [date_str] + [d for d in top_dates if d != date_str]
        dates = dates[: max(1, panorama_top_k)]  # keep it small

        # AwardTool (single multi-program call per date) + SERP route per date
        tasks = []
        for d in dates:
            tasks.append(
                _awardtool_realtime(
                    origin, destination, d, cabins, pax, programs, client
                )
            )
            tasks.append(serp_route(origin, destination, d, filt, client))

        results = await asyncio.gather(*tasks)
        # results alternates award, serp for each date
        edges = {}
        for i in range(0, len(results), 2):
            aw = results[i]
            sr = results[i + 1]
            award_edges = _merge_award_edges(aw)
            serp_map = serp_route_to_leg_map(sr)

            # merge (award-first)
            for key, info in award_edges.items():
                dep, arr, fn = key
                cash_blob = serp_map.get(key, {})
                edges[key] = {
                    "cash_cost": cash_blob.get("cash_cost"),
                    "time_cost": info.get("travel_minutes")
                    or cash_blob.get("time_cost"),
                    "points_cost": info.get("award_points"),
                    "points_program": info.get("program_code"),
                    "points_surcharge": info.get("surcharge"),
                    "transfer_partners": info.get("transfer_partners") or [],
                    "departure_time": info.get("departure_time")
                    or cash_blob.get("departure_time"),
                    "arrival_time": info.get("arrival_time")
                    or cash_blob.get("arrival_time"),
                }
            # add extra good cash-only legs (serp_map keys not in awards), cap count
            added = 0
            for key, cash_blob in serp_map.items():
                if key in edges:
                    continue
                if added >= 12:
                    break
                edges[key] = {
                    "cash_cost": cash_blob.get("cash_cost"),
                    "time_cost": cash_blob.get("time_cost"),
                    "points_cost": None,
                    "points_program": None,
                    "points_surcharge": None,
                    "transfer_partners": [],
                    "departure_time": cash_blob.get("departure_time"),
                    "arrival_time": cash_blob.get("arrival_time"),
                }
                added += 1

        return edges
    finally:
        await client.aclose()


def get_flights_award_first_with_points(
    origin,
    destination,
    user_points,
    filters=None,
    award_programs=None,
    panorama_top_k=2,
):
    return asyncio.run(
        get_flights_award_first_with_points_async(
            origin, destination, user_points, filters, award_programs, panorama_top_k
        )
    )


async def get_flights_serp_first_with_points_async(
    origin, destination, user_points, filters=None, award_programs=None
):
    # Broad SERP first (one call), then a single AwardTool call to match awards
    filt = dict(filters or {})
    date_str = filt.get("outbound_date", "2025-10-18")
    pax = int(filt.get("pax") or 1)
    cabins = _normalize_cabin_for_award_api(filt.get("travel_class"))
    programs = (
        award_programs
        or filt.get("award_programs")
        or get_award_programs_for_api()
    )

    client = await _http_client()
    try:
        sr = await serp_route(origin, destination, date_str, filt, client)
        serp_map = serp_route_to_leg_map(sr)
        aw = await _awardtool_realtime(
            origin, destination, date_str, cabins, pax, programs, client
        )
        award_edges = _merge_award_edges(aw)

        edges = {}
        # add SERP legs, annotate with awards if available
        for key, cash_blob in serp_map.items():
            info = award_edges.get(key)
            if info:
                edges[key] = {
                    "cash_cost": cash_blob.get("cash_cost"),
                    "time_cost": info.get("travel_minutes")
                    or cash_blob.get("time_cost"),
                    "points_cost": info.get("award_points"),
                    "points_program": info.get("program_code"),
                    "points_surcharge": info.get("surcharge"),
                    "transfer_partners": info.get("transfer_partners") or [],
                    "departure_time": info.get("departure_time")
                    or cash_blob.get("departure_time"),
                    "arrival_time": info.get("arrival_time")
                    or cash_blob.get("arrival_time"),
                }
            else:
                edges[key] = {
                    "cash_cost": cash_blob.get("cash_cost"),
                    "time_cost": cash_blob.get("time_cost"),
                    "points_cost": None,
                    "points_program": None,
                    "points_surcharge": None,
                    "transfer_partners": [],
                    "departure_time": cash_blob.get("departure_time"),
                    "arrival_time": cash_blob.get("arrival_time"),
                }
        # add award-only if any remain
        added = 0
        for key, info in award_edges.items():
            if key in edges and edges[key].get("cash_cost") is not None:
                continue
            if added >= 12:
                break
            edges[key] = {
                "cash_cost": None,
                "time_cost": info.get("travel_minutes"),
                "points_cost": info.get("award_points"),
                "points_program": info.get("program_code"),
                "points_surcharge": info.get("surcharge"),
                "transfer_partners": info.get("transfer_partners") or [],
                "departure_time": info.get("departure_time"),
                "arrival_time": info.get("arrival_time"),
            }
            added += 1
        return edges
    finally:
        await client.aclose()


def get_flights_serp_first_with_points(
    origin, destination, user_points, filters=None, award_programs=None
):
    return asyncio.run(
        get_flights_serp_first_with_points_async(
            origin, destination, user_points, filters, award_programs
        )
    )


def pick_strategy_and_search(
    origin, destination, user_points, filters=None, strategy="award_first", **kwargs
):
    if strategy == "serp_first":
        return get_flights_serp_first_with_points(
            origin, destination, user_points, filters, **kwargs
        )
    return get_flights_award_first_with_points(
        origin, destination, user_points, filters, **kwargs
    )
