#!/usr/bin/env python3
"""
SerpAPI + AwardTool: get flights from SerpAPI, then enrich with points from AwardTool.

1. SerpAPI (get_flights_between_airports): list of flight options with cash price and legs.
2. AwardTool (search_real_time): award points and surcharge per leg.
3. Match legs by (origin, destination, flight_number) and attach points to each option.

Run from backend/:
  PYTHONPATH=. python serp_award_flights.py [--origin JFK] [--destination LHR] [--date 2025-12-28]

Requires: SERPAPI_KEY or SERP_API_KEY, AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY (or pass --api-key).
"""
import argparse
import json
import os
import re
import sys
from pathlib import Path

# Ensure backend is on path
_backend = Path(__file__).resolve().parent
if str(_backend) not in sys.path:
    sys.path.insert(0, str(_backend))

try:
    from dotenv import load_dotenv
    load_dotenv(_backend / ".env")
except ImportError:
    pass  # .env not loaded; use exported SERPAPI_KEY, AWARD_TOOL_API_KEY, etc.


def _normalize_flightnum(x):
    return re.sub(r"\s+", "", str(x or "").strip().upper())


def _airport_id(a):
    """Extract IATA id from SerpAPI airport field (dict with 'id' or plain string)."""
    if isinstance(a, dict):
        return (a.get("id") or a.get("name") or "").strip().upper()
    return str(a or "").strip().upper()


def _fetch_serp_flights(origin: str, destination: str, date: str):
    from src.handlers.serp_client import get_flights_between_airports
    return get_flights_between_airports(origin, destination, date)


def _fetch_awardtool(origin: str, destination: str, date: str, programs: list, cabins: list, pax: int, api_key: str):
    import requests
    url = "https://www.awardtool-api.com/search_real_time"
    payload = json.dumps({
        "origin": origin,
        "destination": destination,
        "programs": programs,
        "cabins": cabins,
        "date": date,
        "pax": str(pax),
        "api_key": api_key,
    })
    headers = {"Content-Type": "application/json"}
    r = requests.post(url, headers=headers, data=payload, timeout=30)
    try:
        return r.json()
    except Exception:
        return {"status": r.status_code, "data": [], "error": "Invalid JSON response"}


def _build_award_map(award_resp: dict):
    """Build (dep, arr, flight_number) -> {award_points, surcharge, program_code}. Keeps lowest points per edge."""
    data = award_resp.get("data") or []
    by_edge = {}
    for item in data:
        fare = item.get("fare") or {}
        products = fare.get("products") or []
        pts = item.get("award_points")
        sur = item.get("surcharge")
        prog = (item.get("program_code") or item.get("airline_code") or "").upper()
        for p in products:
            dep = (p.get("origin") or "").strip().upper()
            arr = (p.get("destination") or "").strip().upper()
            fn = _normalize_flightnum(p.get("flight_number"))
            if not dep or not arr or not fn or pts is None:
                continue
            key = (dep, arr, fn)
            prev = by_edge.get(key)
            if prev is None or (isinstance(pts, (int, float)) and (prev.get("award_points") or 0) > pts):
                by_edge[key] = {
                    "award_points": int(pts) if pts is not None else None,
                    "surcharge": float(sur) if isinstance(sur, (int, float)) else None,
                    "program_code": prog or None,
                }
    return by_edge


def _enrich_serp_with_awards(serp_options: list, award_map: dict):
    """Attach points to each SerpAPI option by matching legs to award_map."""
    out = []
    for opt in serp_options:
        legs = opt.get("flights") or []
        points_total = 0
        surcharge_total = None
        programs = []
        legs_enriched = []

        for leg in legs:
            dep = _airport_id(leg.get("departure_airport"))
            arr = _airport_id(leg.get("arrival_airport"))
            fn = _normalize_flightnum(leg.get("flight_number"))

            info = award_map.get((dep, arr, fn)) if (dep and arr and fn) else None
            leg_copy = dict(leg)
            if info:
                leg_copy["award_points"] = info.get("award_points")
                leg_copy["award_surcharge"] = info.get("surcharge")
                leg_copy["award_program"] = info.get("program_code")
                if info.get("award_points") is not None:
                    points_total += info["award_points"]
                if info.get("surcharge") is not None:
                    surcharge_total = (surcharge_total or 0) + info["surcharge"]
                if info.get("program_code"):
                    programs.append(info["program_code"])
            else:
                leg_copy["award_points"] = None
                leg_copy["award_surcharge"] = None
                leg_copy["award_program"] = None
            legs_enriched.append(leg_copy)

        o = dict(opt)
        o["flights"] = legs_enriched
        o["points_total"] = points_total if points_total else None
        o["points_surcharge"] = surcharge_total
        o["points_programs"] = list(dict.fromkeys(programs))  # unique, order kept
        out.append(o)
    return out


def run(origin: str, destination: str, date: str, programs: list, cabins: list, pax: int, api_key: str):
    serp = _fetch_serp_flights(origin, destination, date)
    if not serp:
        return {"error": "No flights from SerpAPI", "origin": origin, "destination": destination, "date": date, "options": []}

    award_resp = {"status": None, "data": []}
    if api_key:
        award_resp = _fetch_awardtool(origin, destination, date, programs, cabins, pax, api_key)
    award_map = {}
    if award_resp.get("status") == 200:
        award_map = _build_award_map(award_resp)
    # else: continue with empty award_map (all points will be None)

    options = _enrich_serp_with_awards(serp, award_map)
    return {
        "origin": origin,
        "destination": destination,
        "date": date,
        "award_tool_status": award_resp.get("status"),
        "options": options,
    }


def main():
    ap = argparse.ArgumentParser(description="SerpAPI flights + AwardTool points")
    ap.add_argument("--origin", "-o", default="JFK", help="Origin IATA (default: JFK)")
    ap.add_argument("--destination", "-d", default="LHR", help="Destination IATA (default: LHR)")
    ap.add_argument("--date", "-D", default="2025-12-28", help="Date YYYY-MM-DD (default: 2025-12-28)")
    ap.add_argument("--programs", "-p", default="UA,DL,AA", help="AwardTool programs, comma-separated (default: UA,DL,AA)")
    ap.add_argument("--cabins", "-c", default="Economy", help="AwardTool cabins, comma-separated (default: Economy)")
    ap.add_argument("--pax", type=int, default=1, help="Passengers (default: 1)")
    ap.add_argument("--api-key", "-k", help="AwardTool API key (default: AWARD_TOOL_API_KEY or AWARDTOOL_API_KEY)")
    ap.add_argument("--json", "-j", action="store_true", help="Output raw JSON")
    args = ap.parse_args()

    programs = [x.strip() for x in args.programs.split(",") if x.strip()]
    cabins = [x.strip() for x in args.cabins.split(",") if x.strip()]
    api_key = args.api_key or os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
    if not api_key:
        print("Warning: No AWARD_TOOL_API_KEY; SerpAPI flights only, award points will be empty.", file=sys.stderr)
        api_key = ""

    result = run(
        origin=args.origin.strip().upper(),
        destination=args.destination.strip().upper(),
        date=args.date.strip(),
        programs=programs,
        cabins=cabins,
        pax=args.pax,
        api_key=api_key,
    )

    if args.json:
        print(json.dumps(result, indent=2))
        return

    # Pretty print
    err = result.get("error")
    if err:
        print(err)
    print(f"Flights {result.get('origin')} → {result.get('destination')} on {result.get('date')} (AwardTool status: {result.get('award_tool_status')})")
    print("-" * 80)
    for i, opt in enumerate(result.get("options", [])[:15], 1):
        cash = opt.get("price")
        pts = opt.get("points_total")
        sur = opt.get("points_surcharge")
        legs = opt.get("flights") or []
        route = " → ".join(
            f"{_airport_id(lg.get('departure_airport')) or '?'}-{_airport_id(lg.get('arrival_airport')) or '?'} ({lg.get('flight_number') or ''})"
            for lg in legs
        )
        pts_str = f"{pts:,} pts" if pts else "—"
        sur_str = f", surcharge ${sur:.0f}" if sur is not None else ""
        print(f"  {i}. ${cash}  |  {pts_str}{sur_str}  |  {route}")
    n = len(result.get("options", []))
    if n > 15:
        print(f"  ... and {n - 15} more")
    print(f"\nTotal: {n} options")


if __name__ == "__main__":
    main()
