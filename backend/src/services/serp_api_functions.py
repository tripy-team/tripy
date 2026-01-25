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


def _get_commercial_set():
    from src.handlers.airport_filter import load_commercial_iata_set_from_web
    return load_commercial_iata_set_from_web()


def _is_commercial(iata: str, commercial_set: set) -> bool:
    from src.handlers.airport_filter import is_commercial_airport
    return is_commercial_airport(iata, commercial_set)


def autocomplete_destinations(
    q: str,
    gl: str = "us",
    hl: str = "en",
    exclude_regions: bool = False,
    commercial_only: bool = False,
) -> List[Dict[str, Any]]:
    """
    Destination autocomplete via SerpAPI google_flights_autocomplete.
    If commercial_only=True, filters to commercial airports only (scheduled_service + large/medium/small).
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
        commercial_set: Optional[set] = None
        if commercial_only:
            try:
                commercial_set = _get_commercial_set()
            except Exception:
                commercial_set = set()

        out: List[Dict[str, Any]] = []
        for s in raw:
            ap = s.get("airports") or []
            if commercial_only and commercial_set is not None:
                ap = [
                    a for a in ap
                    if _is_commercial((a.get("id") or "").strip(), commercial_set)
                ]
            entry: Dict[str, Any] = {
                "name": s.get("name") or "",
                "type": s.get("type") or "",
                "description": s.get("description") or "",
                "id": s.get("id") or "",
            }
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
            if commercial_only and commercial_set is not None:
                sid = (s.get("id") or "").strip().upper()
                stype = (s.get("type") or "").strip().lower()
                if stype == "airport" and len(sid) == 3 and sid not in commercial_set:
                    continue
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
    commercial_only: bool = False,
) -> List[Dict[str, Any]]:
    """
    Round-trip (type=2) or one-way (type=1) via SerpAPI google_flights.
    If commercial_only=True, returns [] when origin or destination is not a commercial airport.
    Returns: best_flights + other_flights (each with price, flights[], total_duration, etc.)
    """
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_serp_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy Google Flights data for %s->%s", origin, destination)
        body = generate_dummy_serp_data(origin, destination, outbound_date, travel_class)
        best = body.get("best_flights") or []
        other = body.get("other_flights") or []
        return list(best) + list(other)
    
    key = _serp_key()
    if not key or not origin or not destination or not outbound_date:
        return []

    if commercial_only:
        try:
            commercial_set = _get_commercial_set()
            if not _is_commercial((origin or "").strip(), commercial_set) or not _is_commercial((destination or "").strip(), commercial_set):
                return []
        except Exception:
            pass

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
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_flight_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy AwardTool data for %s->%s", origin, destination)
        return generate_dummy_flight_data(
            (origin or "").strip().upper(),
            (destination or "").strip().upper(),
            (date or "").strip(),
            cabins or ["Economy"],
            programs or ["UA", "DL", "AA"],
            int(pax) if pax is not None else 1
        )
    
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
    commercial_only: bool = False,
) -> Dict[str, Any]:
    """
    Round-trip: SerpAPI (cash) + AwardTool (points + surcharge). Rank by out-of-pocket.
    If commercial_only=True, returns an error when origin or destination is not a commercial airport.
    Out-of-pocket: cash (if pay cash) or surcharge (if use points). We pick the lower for each option when both exist.
    Returns: { best_by_cash, best_by_surcharge, best_overall, options }
    """
    prog = programs or ["UA", "DL", "AA"]
    cab = cabins or ["Economy"]

    if commercial_only:
        try:
            commercial_set = _get_commercial_set()
            if not _is_commercial((origin or "").strip(), commercial_set) or not _is_commercial((destination or "").strip(), commercial_set):
                return {
                    "best_by_cash": None,
                    "best_by_surcharge": None,
                    "best_overall": None,
                    "options": [],
                    "error": "Origin and destination must be commercial airports (scheduled service).",
                    "origin": (origin or "").strip().upper(),
                    "destination": (destination or "").strip().upper(),
                    "outbound_date": outbound_date,
                    "return_date": return_date,
                }
        except Exception:
            pass

    # 1) SerpAPI round-trip
    serp_all = get_google_flights(origin, destination, outbound_date, return_date, commercial_only=commercial_only)
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


# --- Google Hotels (SerpAPI) ---


def get_google_hotels(
    q: str,
    check_in_date: str,
    check_out_date: str,
    adults: int = 2,
    currency: str = "USD",
    gl: str = "us",
    hl: str = "en",
    sort_by: int = 3,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    """
    SerpAPI engine=google_hotels. sort_by=3 is lowest price.
    Returns: [{ name, cash_total, cash_per_night, property_token, source }]
    """
    # Check if dummy mode is enabled
    from src.config import is_awardtool_dummy_mode
    if is_awardtool_dummy_mode():
        from src.handlers.awardtool_dummy import generate_dummy_hotel_data
        import logging
        logging.getLogger(__name__).info("[DUMMY MODE] Returning dummy Google Hotels data for %s", q)
        # Generate dummy hotel data and convert to Google Hotels format
        dummy = generate_dummy_hotel_data(q, check_in_date, check_out_date, ["HH", "MAR", "HYATT", "IHG"], adults)
        out = []
        for h in (dummy.get("data") or [])[:limit]:
            out.append({
                "name": h.get("name", ""),
                "cash_total": h.get("cash_cost"),
                "cash_per_night": h.get("cash_cost") / max(1, (h.get("nights") or 1)) if h.get("cash_cost") else None,
                "property_token": h.get("hotel_id"),
                "source": "google_hotels_dummy",
                "overall_rating": h.get("star_rating"),
            })
        return out
    
    key = _serp_key()
    if not key or not (q or "").strip() or not check_in_date or not check_out_date:
        return []

    params: Dict[str, Any] = {
        "engine": "google_hotels",
        "q": (q or "").strip(),
        "check_in_date": (check_in_date or "").strip(),
        "check_out_date": (check_out_date or "").strip(),
        "adults": max(1, int(adults)) if adults is not None else 2,
        "currency": (currency or "USD").strip(),
        "gl": gl or "us",
        "hl": hl or "en",
        "sort_by": int(sort_by) if sort_by is not None else 3,
        "api_key": key,
    }

    try:
        search = GoogleSearch(params)
        data = search.get_dict()
        out: List[Dict[str, Any]] = []

        def _extract(prop: Dict) -> None:
            name = (prop.get("name") or "").strip()
            if not name:
                return
            total = None
            per_night = None
            tr = prop.get("total_rate") or {}
            if isinstance(tr, dict):
                total = tr.get("extracted_lowest")
            rpn = prop.get("rate_per_night") or {}
            if isinstance(rpn, dict):
                per_night = rpn.get("extracted_lowest")
            cash = total if total is not None else per_night
            if cash is None:
                return
            token = (prop.get("property_token") or "").strip()
            out.append({
                "name": name,
                "cash_total": float(cash) if total is not None else None,
                "cash_per_night": float(per_night) if per_night is not None else float(cash),
                "property_token": token or None,
                "source": "google_hotels",
                "overall_rating": prop.get("overall_rating"),
            })

        for prop in (data or {}).get("properties") or []:
            if isinstance(prop, dict):
                _extract(prop)
        for ad in (data or {}).get("ads") or []:
            if isinstance(ad, dict):
                pr = ad.get("extracted_price") or ad.get("price")
                if pr is not None and isinstance(pr, (int, float)):
                    out.append({
                        "name": (ad.get("name") or "").strip() or "Hotel",
                        "cash_total": None,
                        "cash_per_night": float(pr),
                        "property_token": (ad.get("property_token") or "").strip() or None,
                        "source": "google_hotels",
                        "overall_rating": ad.get("overall_rating"),
                    })

        return out[:limit]
    except Exception:
        return []


# --- Hotels out-of-pocket: AwardTool (cash + points) + SerpAPI (cash) ---


def optimize_hotels_out_of_pocket(
    destination: str,
    check_in: str,
    check_out: str,
    programs: Optional[List[str]] = None,
    guests: int = 1,
    hotel_class: Optional[str] = None,
    top: int = 15,
) -> Dict[str, Any]:
    """
    Minimize hotel out-of-pocket: AwardTool (cash + points + surcharge) and SerpAPI Google Hotels (cash).
    Out-of-pocket = min(cash, surcharge) when points available, else cash.
    Returns: { best_by_cash, best_by_points, best_overall, options, destination, check_in, check_out }
    """
    options: List[Dict[str, Any]] = []

    # 1) AwardTool: cash, points, surcharge
    try:
        from src.handlers.hotels import search_hotels

        award_rows = search_hotels(
            destination=destination,
            check_in=check_in,
            check_out=check_out,
            programs=programs,
            guests=guests,
            hotel_class=hotel_class,
        )
        for h in award_rows or []:
            cash = h.get("cash_cost")
            pts = h.get("points_cost")
            sur = h.get("surcharge")
            c = float(cash) if cash is not None else None
            p = int(pts) if pts is not None else None
            s = float(sur) if sur is not None else None
            oop = None
            if c is not None and s is not None and p is not None:
                oop = min(c, s)
            elif c is not None:
                oop = c
            elif s is not None:
                oop = s
            options.append({
                "name": h.get("name") or "",
                "cash": c,
                "points": p,
                "surcharge": s,
                "out_of_pocket": oop,
                "brand": h.get("brand") or h.get("program_code") or "",
                "source": "awardtool",
                "hotel_id": h.get("hotel_id"),
            })
    except Exception:
        pass

    # 2) SerpAPI Google Hotels: cash only
    serp = get_google_hotels(
        q=destination,
        check_in_date=check_in,
        check_out_date=check_out,
        adults=guests,
        sort_by=3,
        limit=top,
    )
    for h in serp or []:
        cash = h.get("cash_total") or h.get("cash_per_night")
        if cash is None:
            continue
        c = float(cash)
        options.append({
            "name": h.get("name") or "",
            "cash": c,
            "points": None,
            "surcharge": None,
            "out_of_pocket": c,
            "brand": "",
            "source": "google_hotels",
            "hotel_id": h.get("property_token"),
        })

    if not options:
        return {
            "best_by_cash": None,
            "best_by_points": None,
            "best_overall": None,
            "options": [],
            "destination": (destination or "").strip(),
            "check_in": (check_in or "").strip(),
            "check_out": (check_out or "").strip(),
        }

    by_cash = sorted(options, key=lambda x: (x["cash"] if x["cash"] is not None else 999999999, x["out_of_pocket"] or 999999999))
    by_points = sorted(
        options,
        key=lambda x: (
            x["surcharge"] if x["surcharge"] is not None else 999999999,
            x["cash"] if x["cash"] is not None else 999999999,
        ),
    )
    by_oop = sorted(options, key=lambda x: (x["out_of_pocket"] or 999999999, x["cash"] or 999999999))

    return {
        "best_by_cash": by_cash[0] if by_cash else None,
        "best_by_points": by_points[0] if by_points and by_points[0].get("surcharge") is not None else None,
        "best_overall": by_oop[0] if by_oop else None,
        "options": options[:top],
        "destination": (destination or "").strip(),
        "check_in": (check_in or "").strip(),
        "check_out": (check_out or "").strip(),
    }
