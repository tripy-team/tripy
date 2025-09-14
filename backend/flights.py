# backend/flights.py  (updated, minimal changes to structure)
import os
from typing import Dict, Tuple, Any, Optional, List
from dotenv import load_dotenv
from amadeus import Client as AmadeusClient, Location

from cache_ddb import get_serp_cache, SerpDDBCache
from serp_client import search as serp_search, collect_items, pick_cheapest
from tpg_valuations import fetch_tpg_valuations
from time_utils import extract_hour, hour_bucket, to_minutes
from airport_filter import is_commercial_airport

load_dotenv()
SERPAPI_KEY = os.getenv("SERPAPI_KEY")


# ---- keep this name for compatibility ----
def get_airport_codes(city: str, country_code: str) -> List[str]:
    amadeus = AmadeusClient(
        client_id=os.getenv("AMADEUS_API_KEY"),
        client_secret=os.getenv("AMADEUS_API_SECRET"),
    )
    response = amadeus.reference_data.locations.get(
        countryCode=country_code, keyword=city, subType=Location.AIRPORT
    )
    data = response.result.get("data", [])
    return [
        row.get("iataCode")
        for row in data
        if is_commercial_airport(row.get("iataCode"))
    ]


# ---- points hooks (same behavior as before) ----
def get_points_cost(*args, **kwargs):
    return 100  # replace with your real implementation


def _serp_leg_search(
    dep: str,
    arr: str,
    date_str: str,
    api_key: str,
    filters: dict,
    bucket: Optional[str],
    *,
    coarse: bool
) -> dict:
    params = {
        "engine": "google_flights",
        "api_key": api_key,
        "type": 2,
        "currency": "USD",
        "deep_search": True,
        "departure_id": dep,
        "arrival_id": arr,
        "outbound_date": date_str,
    }
    if not coarse and bucket:
        params["outbound_times"] = bucket
    for k in (
        "stops",
        "bags",
        "include_airlines",
        "exclude_airlines",
        "travel_class",
        "max_price",
    ):
        if k in filters and filters[k] not in (None, {}):
            params[k] = filters[k]
    return serp_search(params)


def _get_leg_best_item(
    dep, arr, date_str, api_key, filters, bucket, cache: SerpDDBCache
):
    res = cache.get_leg(dep, arr, date_str, None, filters, coarse=True)
    if not res:
        res = _serp_leg_search(dep, arr, date_str, api_key, filters, None, coarse=True)
        cache.put_leg(dep, arr, date_str, None, filters, res, coarse=True)
    items = collect_items(res)
    if items:
        return pick_cheapest(items), res
    res2 = cache.get_leg(dep, arr, date_str, bucket, filters, coarse=False)
    if not res2:
        res2 = _serp_leg_search(
            dep, arr, date_str, api_key, filters, bucket, coarse=False
        )
        cache.put_leg(dep, arr, date_str, bucket, filters, res2, coarse=False)
    return pick_cheapest(collect_items(res2)), res2


# ---- keep this name & signature for compatibility ----
def get_flights_between_cities(
    start_iata_code: str,
    end_iata_code: str,
    filters: Optional[dict] = None,
    *,
    time_window_hours: int = 3
) -> Dict[Tuple[str, str, str], Dict[str, Any]]:
    if not SERPAPI_KEY:
        raise RuntimeError("SERPAPI_KEY not set in environment.")
    date_str = (filters or {}).get("outbound_date", "2025-10-18")
    filt = dict(filters or {})
    cache = get_serp_cache()

    full = cache.get_full(start_iata_code, end_iata_code, date_str, filt)
    if not full:
        params = {
            "engine": "google_flights",
            "api_key": SERPAPI_KEY,
            "type": 2,
            "currency": "USD",
            "deep_search": True,
            "departure_id": start_iata_code,
            "arrival_id": end_iata_code,
            "outbound_date": date_str,
        }
        for k in (
            "stops",
            "bags",
            "include_airlines",
            "exclude_airlines",
            "travel_class",
            "max_price",
        ):
            if k in filt and filt[k] not in (None, {}):
                params[k] = filt[k]
        full = serp_search(params)
        cache.put_full(start_iata_code, end_iata_code, date_str, filt, full)

    itineraries = collect_items(full)
    if not itineraries:
        return {}

    tpg_vals = fetch_tpg_valuations()
    edges: Dict[Tuple[str, str, str], Dict[str, Any]] = {}

    for itin in itineraries:
        for leg in itin.get("flights") or []:
            dep = leg["departure_airport"]["id"]
            arr = leg["arrival_airport"]["id"]
            flight_num = "".join(str(leg.get("flight_number", "")).split())
            bucket = hour_bucket(
                extract_hour(leg["departure_airport"].get("time", "")),
                time_window_hours,
            )

            best_item, leg_res = _get_leg_best_item(
                dep, arr, date_str, SERPAPI_KEY, filt, bucket, cache
            )
            # normalize points: allow dict or scalar
            points_raw = {}
            try:
                pr = get_points_cost(leg_res)
                if isinstance(pr, dict):
                    for k, v in pr.items():
                        try:
                            points_raw[str(k)] = int(v)
                        except:
                            pass
                elif pr is not None:
                    points_raw["points"] = int(pr)
            except Exception:
                points_raw = {}

            key = (dep, arr, flight_num)
            if not best_item:
                edges[key] = {
                    "cash_cost": None,
                    "time_cost": to_minutes(leg.get("duration")),
                    "source": "fallback_leg_duration",
                    "points": {"raw": points_raw, "analysis": {}},
                }
                continue

            seg_price = best_item.get("price")
            seg_duration = to_minutes(best_item.get("total_duration"))

            # worth analysis (simple)
            def _eval_points(cash_usd, pts_map):
                out = {"by_program": {}, "best": None}
                if cash_usd is None or not pts_map:
                    return out
                best_prog, best_cpp, best_pts = None, -1.0, None
                for program, pts in pts_map.items():
                    if pts and pts > 0:
                        cpp = (cash_usd * 100.0) / pts
                        out["by_program"][program] = {
                            "points": pts,
                            "realized_cpp": round(cpp, 4),
                        }
                        if cpp > best_cpp:
                            best_prog, best_cpp, best_pts = program, cpp, pts
                if best_prog:
                    out["best"] = {
                        "program": best_prog,
                        "points": best_pts,
                        "realized_cpp": round(best_cpp, 4),
                    }
                return out

            edges[key] = {
                "cash_cost": seg_price,
                "time_cost": seg_duration,
                "source": "serpapi_leg_cached_coarse_precise",
                "points": {
                    "raw": points_raw,
                    "analysis": _eval_points(seg_price, points_raw),
                },
            }
    return edges
