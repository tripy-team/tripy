# backend/award_calendar.py  (AwardTool panorama calendar, normalized)
import os, json
import httpx
from dotenv import load_dotenv

# Fetches and normalizes AwardTool Panorama Calendar data asynchronously.

load_dotenv()

TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=10.0, pool=60.0)

# y=economy, w=premium economy, j=business, f=first
_CABIN_KEYS = [
    ("y", "economy"),
    ("w", "premium_economy"),
    ("j", "business"),
    ("f", "first"),
]


async def _client():
    return httpx.AsyncClient(
        http2=True,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "Tripy/1.0 (+https://tripy.app)",
        },
    )


async def fetch_awardtool_calendar(origin, destination, api_key=None, client=None):
    # Self-hosted engine: chart programs get exact per-cabin points; dynamic
    # programs keep the heuristic estimate; synthetic floor as fallback.
    import logging
    logging.getLogger(__name__).info("[AwardEngine] calendar for %s->%s (self-hosted)", origin, destination)
    try:
        from src.award_pricing import search_award_calendar
        return search_award_calendar(origin, destination)
    except Exception as e:
        logging.getLogger(__name__).error("[AwardEngine] calendar failed (%s); falling back to synthetic floor", e)
        from src.handlers.synthetic_pricing import generate_dummy_calendar_data
        return generate_dummy_calendar_data(origin, destination)


def normalize_awardtool_calendar_row(row):
    date = row.get("date")
    program = (row.get("program") or "").upper()
    route = row.get("route") or ""
    points = row.get("points") or {}
    points_ns = row.get("points_ns") or {}
    cabins = {}
    for key, name in _CABIN_KEYS:
        cabins[name] = {
            "points": (
                points.get(key) if isinstance(points.get(key), (int, float)) else None
            ),
            "tax": (
                (points.get("tax") or {}).get(key)
                if isinstance((points.get("tax") or {}).get(key), (int, float))
                else None
            ),
            "airlines": (points.get("c_a") or {}).get(key) or [],
            "seats": (points.get("c_s") or {}).get(key),
            "available_flag": (points.get("ss") or {}).get(key),
            "nonstop_points": (
                points_ns.get(key)
                if isinstance(points_ns.get(key), (int, float))
                else None
            ),
        }
    return {
        "date": date,
        "program": program,
        "route": route,
        "cabins": cabins,
        "last_seen": points.get("ls"),
        "nonstop_last_seen": points_ns.get("ls"),
        "route_last_seen": row.get("r_ls"),
        "raw": row,
    }


async def get_calendar_matrix(origin, destination, api_key=None, client=None):
    raw = await fetch_awardtool_calendar(origin, destination, api_key, client)
    return [normalize_awardtool_calendar_row(r) for r in raw]


def best_dates_by_cabin(matrix, cabin, top_k=3, require_available=True):
    rows = []
    for r in matrix or []:
        cab = (r.get("cabins") or {}).get(cabin) or {}
        pts = cab.get("points")
        avail = cab.get("available_flag")
        if pts is None:
            continue
        if require_available and not avail:
            continue
        rows.append((pts, r["date"]))
    rows.sort(key=lambda t: (t[0], t[1] or ""))
    return [d for _, d in rows[: int(top_k)]]
