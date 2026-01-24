#!/usr/bin/env python3
"""Find best round-trip combinations by points and by cash. Uses serp_award_flights for each leg."""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parent / ".env")
except ImportError:
    pass


def _airport(a):
    if isinstance(a, dict):
        return (a.get("id") or a.get("name") or "").strip().upper()
    return str(a or "").strip().upper()


def _route(opt):
    legs = opt.get("flights") or []
    return " → ".join(
        f"{_airport(l.get('departure_airport'))}-{_airport(l.get('arrival_airport'))} ({l.get('flight_number') or ''})"
        for l in legs
    )


def run_leg(origin, dest, date, programs, cabins, pax, api_key, script_path):
    cmd = [
        sys.executable, script_path,
        "--origin", origin, "--destination", dest, "--date", date,
        "--programs", programs, "--cabins", cabins, "--pax", str(pax), "--json",
    ]
    if api_key:
        cmd.extend(["--api-key", api_key])
    r = subprocess.run(cmd, cwd=str(Path(script_path).parent), capture_output=True, text=True, env=os.environ)
    try:
        if (r.stdout or "").strip():
            data = json.loads(r.stdout)
            if isinstance(data, dict):
                return data
    except json.JSONDecodeError:
        pass
    err = (r.stderr or "").strip() or (r.stdout or "").strip()
    return {"error": err or "serp_award_flights produced no JSON (check SERPAPI_KEY and network)", "options": []}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--origin", required=True)
    ap.add_argument("--destination", required=True)
    ap.add_argument("--outbound-date", required=True)
    ap.add_argument("--return-date", required=True)
    ap.add_argument("--programs", required=True)
    ap.add_argument("--cabins", required=True)
    ap.add_argument("--pax", type=int, required=True)
    ap.add_argument("--api-key")
    ap.add_argument("--json", action="store_true")
    args = ap.parse_args()

    script_path = str(Path(__file__).resolve().parent / "serp_award_flights.py")
    api_key = args.api_key or os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")

    out = run_leg(args.origin, args.destination, args.outbound_date, args.programs, args.cabins, args.pax, api_key, script_path)
    ret = run_leg(args.destination, args.origin, args.return_date, args.programs, args.cabins, args.pax, api_key, script_path)

    if out.get("error") or not out.get("options"):
        print(out.get("error", "No outbound flights"), file=sys.stderr)
        sys.exit(1)
    if ret.get("error") or not ret.get("options"):
        print(ret.get("error", "No return flights"), file=sys.stderr)
        sys.exit(1)

    top = 10
    combos = []
    for o in out["options"][:top]:
        for r in ret["options"][:top]:
            cash = (o.get("price") or 0) + (r.get("price") or 0)
            pts = (o.get("points_total") or 0) + (r.get("points_total") or 0)
            sur = (o.get("points_surcharge") or 0) + (r.get("points_surcharge") or 0)
            combos.append({"outbound": o, "return": r, "cash": cash, "points": pts, "surcharge": sur})

    by_pts = sorted(combos, key=lambda c: (c["points"] if c["points"] else 999999999, c["cash"]))
    by_cash = sorted(combos, key=lambda c: (c["cash"], c["points"] if c["points"] else 999999999))

    res = {
        "origin": args.origin.strip().upper(),
        "destination": args.destination.strip().upper(),
        "outbound_date": args.outbound_date,
        "return_date": args.return_date,
        "best_by_points": {
            "cash": by_pts[0]["cash"],
            "points": by_pts[0]["points"],
            "surcharge": by_pts[0]["surcharge"],
            "outbound": by_pts[0]["outbound"],
            "return": by_pts[0]["return"],
        },
        "best_by_cash": {
            "cash": by_cash[0]["cash"],
            "points": by_cash[0]["points"],
            "surcharge": by_cash[0]["surcharge"],
            "outbound": by_cash[0]["outbound"],
            "return": by_cash[0]["return"],
        },
    }

    if args.json:
        print(json.dumps(res, indent=2))
        return

    b_pts, b_cash = by_pts[0], by_cash[0]
    print("Best by points:")
    print(f"  Cash (if paid): ${b_pts['cash']:,.0f}   Points: {b_pts['points']:,}   Surcharge (when using points): ${b_pts['surcharge']:,.0f}")
    print(f"  Outbound: {_route(b_pts['outbound'])}")
    print(f"  Return:   {_route(b_pts['return'])}")
    print()
    print("Best by cash:")
    print(f"  Cash: ${b_cash['cash']:,.0f}   Points: {b_cash['points']:,}   Surcharge: ${b_cash['surcharge']:,.0f}")
    print(f"  Outbound: {_route(b_cash['outbound'])}")
    print(f"  Return:   {_route(b_cash['return'])}")


if __name__ == "__main__":
    main()
