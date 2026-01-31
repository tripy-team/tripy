# backend/flights.py  (fast path: Panorama prune → single RT AwardTool → single SERP route)
import logging
import os, re, json, math, asyncio
import httpx
from dotenv import load_dotenv

logger = logging.getLogger(__name__)
from src.utils.cache_layer import get_json, set_json
from src.utils.airline_utils import infer_airline_from_flight_number
from src.config import is_awardtool_dummy_mode

# award_programs: use src.utils.award_programs (src.data.award_programs was removed)
try:
    from src.utils.award_programs import get_award_programs_for_api
except (ModuleNotFoundError, ImportError):
    import importlib.util
    from pathlib import Path
    # Resolve backend/src/utils/award_programs.py from .../src/handlers/flights.py
    _ap = Path(__file__).resolve().parents[2] / "src" / "utils" / "award_programs.py"
    if not _ap.exists():
        raise ModuleNotFoundError(
            "award_programs not found. Ensure backend/src/utils/award_programs.py exists. "
            "Use src.utils.award_programs (src.data.award_programs was removed)."
        ) from None
    _spec = importlib.util.spec_from_file_location("_tripy_award_programs", _ap)
    _mod = importlib.util.module_from_spec(_spec)
    _spec.loader.exec_module(_mod)
    get_award_programs_for_api = _mod.get_award_programs_for_api

from .award_calendar import (
    get_calendar_matrix,
    best_dates_by_cabin,
)
from .serp_client import get_flights_between_airports

# Keep your existing helpers if you have them:
# from serp_client import search as serp_search, collect_items, pick_cheapest
# from time_utils import extract_hour, hour_bucket, to_minutes
# from airport_filter import is_commercial_airport
# from amadeus import Client as AmadeusClient, Location

load_dotenv()
# Support both naming conventions (SERPAPI vs SERP_API; AWARD_TOOL vs AWARDTOOL)
SERPAPI_KEY = os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")

# Log API key status at startup (helps debug missing keys)
if not SERPAPI_KEY:
    logger.warning(
        "SERPAPI_KEY not set. Flight cash prices will not be available. "
        "Set SERPAPI_KEY or SERP_API_KEY in your .env file."
    )
else:
    logger.info("SERPAPI_KEY configured (length=%d)", len(SERPAPI_KEY))

if not AWARD_TOOL_API_KEY:
    logger.warning(
        "AWARD_TOOL_API_KEY not set. Award/points pricing will not be available. "
        "Set AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY in your .env file."
    )
else:
    logger.info("AWARD_TOOL_API_KEY configured (length=%d)", len(AWARD_TOOL_API_KEY))

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


def key_serp(o, d, date, tclass, stops, bags, typ=1):
    return f"serp:{o}:{d}:{date}:{tclass}:{stops}:{bags}:t{typ}"


TTL_AWARD = 6 * 3600  # 6h
TTL_PAN = 24 * 3600  # 24h
TTL_SERP = 90 * 60  # 90m


# ==== SERP route-level (single call) ====
async def serp_route(origin, destination, date_str, filters, client):
    tclass = _normalize_travel_class_for_serp((filters or {}).get("travel_class"))
    
    # Check if dummy mode is enabled - return dummy SERP data
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_serp_data
        logger.info("[DUMMY MODE] Returning dummy SERP data for %s->%s on %s", origin, destination, date_str)
        return generate_dummy_serp_data(origin, destination, date_str, tclass)
    
    # Use type=2 (one-way): SerpAPI type=1 is round-trip and requires return_date.
    # Segment fetch only has outbound_date.
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

    if not SERPAPI_KEY:
        logger.warning("SERPAPI_KEY not set; SERP request for [%s]->[%s] may fail", origin, destination)

    k = key_serp(
        origin, destination, date_str, tclass, params.get("stops"), params.get("bags"), params.get("type", 2)
    )
    cached = get_json(k)
    if cached:
        logger.debug("SERP [%s]->[%s] date=%s: cache hit", origin, destination, date_str)
        return cached

    logger.info("SERP [%s]->[%s] date=%s: requesting (type=%s, travel_class=%s)", origin, destination, date_str, params.get("type"), tclass)
    try:
        r = await client.get(
            "https://serpapi.com/search.json", params=params, timeout=TIMEOUT
        )
        r.raise_for_status()
        body = r.json()
    except httpx.HTTPStatusError as e:
        err_body = (e.response.text or "")[:500]
        logger.warning("SERP [%s]->[%s] date=%s: HTTP %s, body=%s", origin, destination, date_str, e.response.status_code, err_body)
        raise
    except Exception as e:
        logger.warning("SERP [%s]->[%s] date=%s: %s", origin, destination, date_str, e)
        raise

    meta = body.get("search_metadata") or {}
    status = meta.get("status", "?")
    best = body.get("best_flights") or []
    other = body.get("other_flights") or []
    err = body.get("error") or meta.get("error")
    logger.info("SERP [%s]->[%s] date=%s: status=%s, best_flights=%d, other_flights=%d%s", origin, destination, date_str, status, len(best), len(other), f", error={err}" if err else "")
    set_json(k, body, TTL_SERP)
    return body


def serp_route_to_leg_map(route_json):
    """
    Collects best cash per (dep,arr,flight_num) from SERP route.
    Handles multistop flights by extracting all individual legs from each route.
    Supports small airports - extracts all connecting segments (e.g., ITH -> JFK -> CDG).
    """
    by_leg = {}
    skipped = 0
    all_flight_options = (route_json.get("best_flights") or []) + (
        route_json.get("other_flights") or []
    )

    for it in all_flight_options:
        price = _to_number_price(it.get("price"))
        flights = it.get("flights") or []

        for leg in flights:
            dep = leg.get("departure_airport", {}).get("id")
            arr = leg.get("arrival_airport", {}).get("id")
            fn = _normalize_flightnum(leg.get("flight_number"))
            dur = leg.get("duration_in_minutes") or leg.get("durationMinutes") or leg.get("duration")

            if not dep or not arr or not fn:
                skipped += 1
                continue

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

    logger.debug("serp_route_to_leg_map: flight_options=%d, legs=%d, skipped=%d", len(all_flight_options), len(by_leg), skipped)
    return by_leg


# ==== AwardTool (priming + polling API) ====
async def _awardtool_realtime(
    origin, destination, date_str, cabins, pax, programs, client
):
    """
    Fetch award flights using AwardTool API with priming + polling.
    
    Uses the two-phase architecture:
    1. Priming: Initiates async search across airline programs
    2. Polling: Retrieves incremental results until complete
    
    Falls back to dummy data if AWARDTOOL_API_KEY is not set.
    """
    print(f"[AwardTool] _awardtool_realtime called: {origin}->{destination} on {date_str}")
    logger.info("[AwardTool] _awardtool_realtime called: %s->%s on %s", origin, destination, date_str)
    
    # Use dummy data if in dummy mode (no API key or explicitly enabled)
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_flight_data
        print(f"[AwardTool] DUMMY MODE - returning dummy data for {origin}->{destination}")
        logger.info("[DUMMY MODE] Returning dummy flight data for %s->%s on %s", origin, destination, date_str)
        return generate_dummy_flight_data(origin, destination, date_str, cabins, programs, int(pax))
    
    from src.handlers.awardtool_v2 import search_award_flights_v2, convert_v2_result_to_v1_format
    
    # Check cache first
    k = key_award(origin, destination, date_str, cabins, pax, programs)
    cached = get_json(k)
    if cached:
        if cached.get("data") and not cached.get("error") and not cached.get("error_message"):
            logger.debug("AwardTool [%s]->[%s] date=%s: cache hit (data_items=%d)", origin, destination, date_str, len(cached.get("data", [])))
            return cached
        else:
            logger.debug("AwardTool [%s]->[%s] date=%s: cache contains error/empty, refetching", origin, destination, date_str)
    
    n_prog = len(programs) if programs else 0
    logger.info("AwardTool [%s]->[%s] date=%s: requesting (programs=%d, cabins=%s, pax=%s)", origin, destination, date_str, n_prog, cabins, pax)
    
    try:
        # Execute search with priming + polling
        # Config is read from env vars in awardtool_v2.py:
        #   AWARDTOOL_POLL_INTERVAL (default: 5s)
        #   AWARDTOOL_MAX_POLL_TIME (default: 60s)
        #   AWARDTOOL_PROGRAM_BATCH_SIZE (default: 3)
        result = await search_award_flights_v2(
            origin=origin,
            destination=destination,
            date=date_str,
            cabins=cabins,
            pax=pax,
            programs=programs,
            api_key=AWARD_TOOL_API_KEY,
        )
        
        # Convert result format for compatibility with _merge_award_edges
        body = convert_v2_result_to_v1_format(result)
        
        data = body.get("data", [])
        err = result.error
        
        logger.info(
            "AwardTool [%s]->[%s] date=%s: data_items=%d finished=%s polls=%d%s",
            origin, destination, date_str, len(data), result.finished, result.total_polls,
            f", error={err}" if err else ""
        )
        
        # Cache successful responses with data (only if we got actual data)
        if data and len(data) > 0 and not err:
            logger.info("AwardTool [%s]->[%s] date=%s: caching %d items", origin, destination, date_str, len(data))
            set_json(k, body, TTL_AWARD)
        elif err:
            logger.warning("AwardTool [%s]->[%s] date=%s: API error (not caching): %s", origin, destination, date_str, err)
        elif not data or len(data) == 0:
            logger.warning("AwardTool [%s]->[%s] date=%s: no data items returned (not caching)", origin, destination, date_str)
        
        return body
        
    except Exception as e:
        logger.error("AwardTool [%s]->[%s] date=%s: exception: %s", origin, destination, date_str, str(e))
        return {"error": str(e), "data": []}


def _merge_award_edges(rt_json):
    # Returns dict (dep,arr,fn)-> award fields (cheapest per flight)
    data = rt_json.get("data", []) if isinstance(rt_json, dict) else []
    by_edge = {}
    skipped = 0
    
    # Debug: log sample data structure on first call with data
    if data:
        logger.debug("_merge_award_edges: processing %d items", len(data))
    
    for item in data:
        fare = item.get("fare") or {}
        products = fare.get("products") or []
        pts = item.get("award_points")
        sur = item.get("surcharge")
        prog = (item.get("program_code") or item.get("airline_code") or "").upper()
        xfer = item.get("transfer_options") or []
        
        if not products:
            skipped += 1
            continue
            
        for p in products:
            dep = (p.get("origin") or "").upper()
            arr = (p.get("destination") or "").upper()
            fn = _normalize_flightnum(p.get("flight_number"))
            if not dep or not arr or not fn or pts is None:
                skipped += 1
                continue
            # Operating carrier from AwardTool (e.g. KE for Delta-codeshare Korean Air); used for transfer instructions
            op_raw = p.get("operating_carrier") or p.get("operating_airline") or p.get("carrier") or ""
            op_al = str(op_raw).strip().upper()[:2] if op_raw and len(str(op_raw).strip()) >= 2 else None
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
                    "operating_airline": op_al,
                    "travel_minutes": travel_minutes,
                    "departure_time": dep_time,
                    "arrival_time": arr_time,
                }
    
    logger.info("_merge_award_edges: data_items=%d, edges=%d, skipped=%d", len(data), len(by_edge), skipped)
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
    date_str = filt.get("outbound_date")
    if not date_str:
        # Don't use hardcoded dates - this causes wrong search results
        logger.error("get_flights_award_first_with_points_async: outbound_date missing from filters - using today")
        from datetime import date
        date_str = date.today().isoformat()
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
        edges = {}
        for i in range(0, len(results), 2):
            d = dates[i // 2] if i // 2 < len(dates) else "?"
            aw = results[i]
            sr = results[i + 1]
            award_edges = _merge_award_edges(aw)
            serp_map = serp_route_to_leg_map(sr)
            logger.info("flights [%s]->[%s] date=%s: award_edges=%d, serp_legs=%d", origin, destination, d, len(award_edges), len(serp_map))

            # Find best award options by O-D (ignoring flight number) for fallback
            best_award_by_od = {}
            for key, info in award_edges.items():
                dep, arr, fn = key
                od_key = (dep, arr)
                pts = info.get("award_points")
                if pts is None:
                    continue
                existing = best_award_by_od.get(od_key)
                if existing is None or pts < existing.get("award_points", float("inf")):
                    best_award_by_od[od_key] = info

            # Find best cash option by O-D for fallback
            best_cash_by_od = {}
            for key, cash_blob in serp_map.items():
                dep, arr = key[0], key[1]
                od_key = (dep, arr)
                cash = cash_blob.get("cash_cost")
                if cash is None:
                    continue
                existing = best_cash_by_od.get(od_key)
                if existing is None or cash < existing.get("cash_cost", float("inf")):
                    best_cash_by_od[od_key] = cash_blob

            # merge (award-first)
            for key, info in award_edges.items():
                dep, arr, fn = key
                od_key = (dep, arr)
                # First try exact flight number match
                cash_blob = serp_map.get(key, {})
                # If no exact match, use best cash option for this O-D pair
                if not cash_blob.get("cash_cost") and od_key in best_cash_by_od:
                    cash_blob = best_cash_by_od[od_key]
                # Prefer AwardTool operating_airline (codeshare); else program or infer from flight number
                _al = (info.get("operating_airline") or info.get("program_code") or "").strip().upper() or infer_airline_from_flight_number(fn)
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
                    "operating_airline": _al[:2] if _al and len(_al) >= 2 else infer_airline_from_flight_number(fn),
                }
            # add extra good cash-only legs (serp_map keys not in awards), cap count
            # Also attach best award option for the same O-D pair
            added = 0
            for key, cash_blob in serp_map.items():
                if key in edges:
                    continue
                if added >= 12:
                    break
                dep, arr = key[0], key[1]
                fn = key[2] if len(key) >= 3 else ""
                od_key = (dep, arr)
                # Get best award option for this O-D pair (if available)
                best_award = best_award_by_od.get(od_key, {})
                edges[key] = {
                    "cash_cost": cash_blob.get("cash_cost"),
                    "time_cost": cash_blob.get("time_cost"),
                    "points_cost": best_award.get("award_points"),
                    "points_program": best_award.get("program_code"),
                    "points_surcharge": best_award.get("surcharge"),
                    "transfer_partners": best_award.get("transfer_partners") or [],
                    "departure_time": cash_blob.get("departure_time"),
                    "arrival_time": cash_blob.get("arrival_time"),
                    "operating_airline": infer_airline_from_flight_number(fn),
                    "award_from_different_flight": bool(best_award),  # Flag that award is from different flight
                }
                added += 1

        logger.info("flights [%s]->[%s] award_first: total_edges=%d", origin, destination, len(edges))
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
    date_str = filt.get("outbound_date")
    if not date_str:
        # Don't use hardcoded dates - this causes wrong search results
        logger.error("get_flights_serp_first_with_points_async: outbound_date missing from filters - using today")
        from datetime import date
        date_str = date.today().isoformat()
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
        logger.info("flights [%s]->[%s] date=%s serp_first: serp_legs=%d, award_edges=%d", origin, destination, date_str, len(serp_map), len(award_edges))

        # Find best award options by O-D (ignoring flight number) for fallback
        best_award_by_od = {}
        for key, info in award_edges.items():
            dep, arr, fn = key
            od_key = (dep, arr)
            pts = info.get("award_points")
            if pts is None:
                continue
            existing = best_award_by_od.get(od_key)
            if existing is None or pts < existing.get("award_points", float("inf")):
                best_award_by_od[od_key] = info

        # Find best cash option by O-D for fallback
        best_cash_by_od = {}
        for key, cash_blob in serp_map.items():
            dep, arr = key[0], key[1]
            od_key = (dep, arr)
            cash = cash_blob.get("cash_cost")
            if cash is None:
                continue
            existing = best_cash_by_od.get(od_key)
            if existing is None or cash < existing.get("cash_cost", float("inf")):
                best_cash_by_od[od_key] = cash_blob

        edges = {}
        # add SERP legs, annotate with awards if available
        for key, cash_blob in serp_map.items():
            dep, arr = key[0], key[1]
            fn = key[2] if len(key) >= 3 else ""
            od_key = (dep, arr)
            # First try exact flight number match for awards
            info = award_edges.get(key)
            # If no exact match, use best award option for this O-D pair
            if not info and od_key in best_award_by_od:
                info = best_award_by_od[od_key]
            if info:
                _al = (info.get("operating_airline") or info.get("program_code") or "").strip().upper() or infer_airline_from_flight_number(fn)
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
                    "operating_airline": _al[:2] if _al and len(_al) >= 2 else infer_airline_from_flight_number(fn),
                    "award_from_different_flight": key not in award_edges,
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
                    "operating_airline": infer_airline_from_flight_number(fn),
                }
        # add award-only if any remain (with best cash fallback for the O-D pair)
        added = 0
        for key, info in award_edges.items():
            if key in edges and edges[key].get("cash_cost") is not None:
                continue
            if added >= 12:
                break
            dep, arr = key[0], key[1]
            fn = key[2] if len(key) >= 3 else ""
            od_key = (dep, arr)
            # Try to get cash cost from best cash option for this O-D
            cash_blob = best_cash_by_od.get(od_key, {})
            _al = (info.get("operating_airline") or info.get("program_code") or "").strip().upper() or infer_airline_from_flight_number(fn)
            edges[key] = {
                "cash_cost": cash_blob.get("cash_cost"),
                "time_cost": info.get("travel_minutes") or cash_blob.get("time_cost"),
                "points_cost": info.get("award_points"),
                "points_program": info.get("program_code"),
                "points_surcharge": info.get("surcharge"),
                "transfer_partners": info.get("transfer_partners") or [],
                "departure_time": info.get("departure_time") or cash_blob.get("departure_time"),
                "arrival_time": info.get("arrival_time") or cash_blob.get("arrival_time"),
                "operating_airline": _al[:2] if _al and len(_al) >= 2 else infer_airline_from_flight_number(fn),
            }
            added += 1
        logger.info("flights [%s]->[%s] serp_first: total_edges=%d", origin, destination, len(edges))
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


def get_flights_serp_only(origin, destination, date_str, filters=None):
    """
    Sync SERP-only flight fetch using serp_client.get_flights_between_airports.
    Returns edges dict compatible with the rest of the flight pipeline (ILP, etc.).
    Used as a fallback when award-first and async SERP-first return no edges.
    """
    # Check if dummy mode is enabled
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_serp_data
        logger.info("[DUMMY MODE] Returning dummy SERP-only data for %s->%s on %s", origin, destination, date_str)
        filt = dict(filters or {})
        travel_class = _normalize_travel_class_for_serp(filt.get("travel_class"))
        body = generate_dummy_serp_data(origin, destination, date_str, travel_class)
        serp_map = serp_route_to_leg_map(body)
        edges = {}
        for key, cash_blob in serp_map.items():
            fn = key[2] if len(key) >= 3 else ""
            edges[key] = {
                "cash_cost": cash_blob.get("cash_cost"),
                "time_cost": cash_blob.get("time_cost"),
                "points_cost": None,
                "points_program": None,
                "points_surcharge": None,
                "transfer_partners": [],
                "departure_time": cash_blob.get("departure_time"),
                "arrival_time": cash_blob.get("arrival_time"),
                "operating_airline": infer_airline_from_flight_number(fn),
            }
        logger.info(
            "[DUMMY MODE] get_flights_serp_only [%s]->[%s] date=%s: %d edges",
            origin, destination, date_str, len(edges),
        )
        return edges
    
    filt = dict(filters or {})
    travel_class = _normalize_travel_class_for_serp(filt.get("travel_class"))
    # Use one-way (type=2): SerpAPI requires return_date for round-trip (type=1).
    # Segment fetches only have outbound_date, so one-way is correct.
    flights = get_flights_between_airports(
        (origin or "").strip().upper(),
        (destination or "").strip().upper(),
        (date_str or "").strip(),
        travel_class=travel_class,
        trip_type=2,
    )
    if not flights:
        return {}
    body = {"best_flights": flights, "other_flights": []}
    serp_map = serp_route_to_leg_map(body)
    edges = {}
    for key, cash_blob in serp_map.items():
        fn = key[2] if len(key) >= 3 else ""
        edges[key] = {
            "cash_cost": cash_blob.get("cash_cost"),
            "time_cost": cash_blob.get("time_cost"),
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "transfer_partners": [],
            "departure_time": cash_blob.get("departure_time"),
            "arrival_time": cash_blob.get("arrival_time"),
            "operating_airline": infer_airline_from_flight_number(fn),
        }
    logger.info(
        "get_flights_serp_only [%s]->[%s] date=%s: %d edges from serp_client.get_flights_between_airports",
        origin, destination, date_str, len(edges),
    )
    return edges


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


# ===========================================================================
# AGENT-COMPATIBLE WRAPPER FUNCTIONS
# ===========================================================================

async def search_awardtool_flights(
    origin: str,
    destination: str,
    date: str,
    programs: list[str] = None,
    cabins: list[str] = None,
    pax: int = 1,
) -> list[dict]:
    """
    Search for award flights using AwardTool API.
    
    This is the agent-compatible wrapper around _awardtool_realtime.
    Returns a list of normalized flight options.
    
    Args:
        origin: Origin airport IATA code
        destination: Destination airport IATA code  
        date: Date in YYYY-MM-DD format
        programs: List of award programs (e.g., ["UA", "AA"])
        cabins: List of cabin classes (e.g., ["Economy", "Business"])
        pax: Number of passengers
        
    Returns:
        List of flight options with standardized fields:
        - airline, cabin, cash_price, program, points, surcharge, available
        - departure_time, arrival_time, duration, stops, flight_numbers
    """
    cabins = cabins or ["Economy", "Business"]
    programs = programs or get_award_programs_for_api()
    
    client = await _http_client()
    try:
        raw_result = await _awardtool_realtime(
            origin, destination, date, cabins, pax, programs, client
        )
        
        # Parse and normalize the results
        data = raw_result.get("data", []) if isinstance(raw_result, dict) else []
        results = []
        
        for item in data:
            if not isinstance(item, dict):
                continue
                
            fare = item.get("fare") or {}
            products = fare.get("products") or []
            
            for product in products:
                dep = (product.get("origin") or "").upper()
                arr = (product.get("destination") or "").upper()
                
                # Only include if matches our route
                if dep != origin.upper() or arr != destination.upper():
                    continue
                
                prog = (item.get("program_code") or "").upper()
                pts = item.get("award_points")
                sur = item.get("surcharge")
                cabin = product.get("cabin") or "Economy"
                
                results.append({
                    "airline": prog,
                    "cabin": cabin,
                    "cash_price": None,  # AwardTool doesn't provide cash price
                    "program": prog,
                    "points": int(pts) if pts else None,
                    "surcharge": float(sur) if sur else 0,
                    "available": pts is not None,
                    "departure_time": product.get("departure_time"),
                    "arrival_time": product.get("arrival_time"),
                    "duration": product.get("travel_minutes") or fare.get("travel_minutes_total"),
                    "stops": len(products) - 1 if len(products) > 1 else 0,
                    "flight_numbers": [product.get("flight_number")] if product.get("flight_number") else [],
                })
        
        logger.info(f"search_awardtool_flights: {origin}->{destination} on {date}: {len(results)} options")
        return results
        
    finally:
        await client.aclose()
