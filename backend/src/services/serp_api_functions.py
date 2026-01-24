"""
SerpAPI (Google Flights, Autocomplete) and AwardTool integration.
- Autocomplete: google_flights_autocomplete for destination suggestions.
- Flights: google_flights for cash prices; AwardTool search_real_time for points + surcharge.
- Optimizer: combine both to rank by out-of-pocket (min cash vs points surcharge).
"""
import os
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from serpapi import GoogleSearch

SERP_URL = "https://serpapi.com/search.json"
AWARDTOOL_URL = "https://www.awardtool-api.com/search_real_time"


def _serp_key() -> str:
    return (os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY") or "").strip()


def _award_key() -> str:
    return (os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY") or "").strip()


# --- Autocomplete (SerpAPI Google Flights Autocomplete) ---


def autocomplete_destinations(
    q: str,
    gl: str = "us",
    hl: str = "en",
    exclude_regions: bool = False,
) -> List[Dict[str, Any]]:
    """
    Destination autocomplete via SerpAPI google_flights_autocomplete.
    Returns: [{ name, type, description, id, airports: [{ id, name, city, city_id, distance }] }]
    """
    key = _serp_key()
    if not key or not (q or "").strip():
        return []

    params: Dict[str, Any] = {
        "engine": "google_flights_autocomplete",
        "q": (q or "").strip(),
        "gl": gl or "us",
        "hl": hl or "en",
        "api_key": key,
    }
    if exclude_regions:
        params["exclude_regions"] = "true"

    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        raw = (data or {}).get("suggestions") or []
        out: List[Dict[str, Any]] = []
        for s in raw:
            entry: Dict[str, Any] = {
                "name": s.get("name") or "",
                "type": s.get("type") or "",
                "description": s.get("description") or "",
                "id": s.get("id") or "",
            }
            ap = s.get("airports") or []
            entry["airports"] = [
                {
                    "id": a.get("id") or "",
                    "name": a.get("name") or "",
                    "city": a.get("city") or "",
                    "city_id": a.get("city_id") or "",
                    "distance": a.get("distance") or "",
                }
                for a in ap
            ]
            out.append(entry)
        return out
    except Exception:
        return []


# --- Flights: SerpAPI Google Flights ---


def get_google_flights(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: Optional[str] = None,
    travel_class: Optional[int] = None,
) -> List[Dict[str, Any]]:
    """
    Round-trip (type=2) or one-way (type=1) via SerpAPI google_flights.
    Returns: best_flights + other_flights (each with price, flights[], total_duration, etc.)
    """
    key = _serp_key()
    if not key or not origin or not destination or not outbound_date:
        return []

    params: Dict[str, Any] = {
        "engine": "google_flights",
        "departure_id": (origin or "").strip().upper(),
        "arrival_id": (destination or "").strip().upper(),
        "outbound_date": (outbound_date or "").strip(),
        "type": "2" if return_date else "1",
        "currency": "USD",
        "hl": "en",
        "api_key": key,
    }
    if return_date:
        params["return_date"] = (return_date or "").strip()
    if travel_class is not None and travel_class in (1, 2, 3, 4):
        params["travel_class"] = str(travel_class)

    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        best = (data or {}).get("best_flights") or []
        other = (data or {}).get("other_flights") or []
        return list(best) + list(other)
    except Exception:
        return []


# --- AwardTool (points + surcharge) ---


def fetch_awardtool(
    origin: str,
    destination: str,
    date: str,
    programs: List[str],
    cabins: List[str],
    pax: int,
) -> Dict[str, Any]:
    """
    AwardTool search_real_time. Returns { status, data: [{ award_points, surcharge, cabin_type, fare, products }] }.
    """
    import requests

    key = _award_key()
    payload = {
        "origin": (origin or "").strip().upper(),
        "destination": (destination or "").strip().upper(),
        "date": (date or "").strip(),
        "programs": programs or ["UA", "DL", "AA"],
        "cabins": cabins or ["Economy"],
        "pax": str(int(pax) if pax is not None else 1),
        "api_key": key or "",
    }
    try:
        r = requests.post(AWARDTOOL_URL, json=payload, headers={"Content-Type": "application/json"}, timeout=30)
        return r.json() if r.text else {"status": r.status_code, "data": []}
    except Exception:
        return {"status": 0, "data": []}


def _min_surcharge_and_points(data: List[Dict]) -> tuple:
    """From AwardTool data, return (min_surcharge, min_points) for Economy."""
    sur, pts = None, None
    for d in data or []:
        cp = (d.get("cabin_type") or "").strip()
        if cp and "economy" not in cp.lower() and "Economy" not in cp:
            continue
        s = d.get("surcharge")
        p = d.get("award_points")
        if s is not None and (sur is None or (isinstance(s, (int, float)) and s < sur)):
            sur = s
        if p is not None and (pts is None or (isinstance(p, (int, float)) and p < pts)):
            pts = p
    return (sur, pts)


# --- Out-of-pocket optimizer ---


def optimize_itinerary_out_of_pocket(
    origin: str,
    destination: str,
    outbound_date: str,
    return_date: str,
    programs: Optional[List[str]] = None,
    cabins: Optional[List[str]] = None,
    pax: int = 1,
    top_per_leg: int = 10,
) -> Dict[str, Any]:
    """
    Round-trip: SerpAPI (cash) + AwardTool (points + surcharge). Rank by out-of-pocket.
    Out-of-pocket: cash (if pay cash) or surcharge (if use points). We pick the lower for each option when both exist.
    Returns: { best_by_cash, best_by_surcharge, best_overall, options }
    """
    prog = programs or ["UA", "DL", "AA"]
    cab = cabins or ["Economy"]

    # 1) SerpAPI round-trip
    serp_all = get_google_flights(origin, destination, outbound_date, return_date)
    if not serp_all:
        return {
            "best_by_cash": None,
            "best_by_surcharge": None,
            "best_overall": None,
            "options": [],
            "error": "No flights from SerpAPI",
        }

    # 2) AwardTool for outbound and return (we use average surcharge/points as proxy for the round-trip combo)
    award_out = fetch_awardtool(origin, destination, outbound_date, prog, cab, pax)
    award_ret = fetch_awardtool(destination, origin, return_date, prog, cab, pax)
    sur_out, pts_out = _min_surcharge_and_points(award_out.get("data") or [])
    sur_ret, pts_ret = _min_surcharge_and_points(award_ret.get("data") or [])

    total_surcharge = None
    if sur_out is not None or sur_ret is not None:
        total_surcharge = (sur_out or 0) + (sur_ret or 0)
    total_points = None
    if pts_out is not None or pts_ret is not None:
        total_points = (pts_out or 0) + (pts_ret or 0)

    # 3) Build options from SerpAPI only (AwardTool doesn’t give per-option; we attach route-level award totals)
    options: List[Dict[str, Any]] = []
    for s in serp_all[:top_per_leg]:
        cash = s.get("price")
        if cash is None:
            continue
        c = int(cash) if isinstance(cash, (int, float)) else 0
        sur = total_surcharge if total_surcharge is not None else None
        pts = total_points if total_points else None
        oop = min(c, sur) if (c and sur is not None) else (c or sur)
        options.append({
            "price": c,
            "points": pts,
            "surcharge": sur,
            "out_of_pocket": oop if oop is not None else c,
            "flights": s.get("flights") or [],
            "total_duration": s.get("total_duration"),
            "type": s.get("type"),
        })

    if not options:
        return {
            "best_by_cash": None,
            "best_by_surcharge": None,
            "best_overall": None,
            "options": [],
        }

    by_cash = sorted(options, key=lambda x: (x["price"] or 0))
    by_surcharge = sorted(options, key=lambda x: (x["surcharge"] if x["surcharge"] is not None else 999999999, x["price"] or 0))
    by_oop = sorted(options, key=lambda x: (x["out_of_pocket"] or 999999999, x["price"] or 0))

    return {
        "origin": (origin or "").strip().upper(),
        "destination": (destination or "").strip().upper(),
        "outbound_date": outbound_date,
        "return_date": return_date,
        "best_by_cash": by_cash[0] if by_cash else None,
        "best_by_surcharge": by_surcharge[0] if by_surcharge and (by_surcharge[0].get("surcharge") is not None) else None,
        "best_overall": by_oop[0] if by_oop else None,
        "options": options,
    }
