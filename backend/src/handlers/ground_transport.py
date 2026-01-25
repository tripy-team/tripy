# Ground transport: bus and car (self-drive) options for any city pair.
# Uses OpenAI to estimate typical prices and durations when no dedicated API is available.
# Enables "AI rover" style multi-modal itineraries (flight + bus + car).

import logging
import os
import re
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

from src.utils.cache_layer import get_json, set_json

load_dotenv()

logger = logging.getLogger(__name__)

# OpenAI key (same as other openAI handlers)
def _openai_client():
    from openai import OpenAI
    key = os.getenv("OPENAI_ADMIN_KEY") or os.getenv("OPENAI_API_KEY")
    if not key:
        raise ValueError("OPENAI_ADMIN_KEY or OPENAI_API_KEY required for ground transport estimates")
    return OpenAI(api_key=key)


def _cache_key(origin: str, destination: str) -> str:
    return f"ground:{origin.upper()}:{destination.upper()}"


TTL_GROUND = 7 * 86400  # 7 days


def _to_int(v: Any) -> Optional[int]:
    if v is None:
        return None
    if isinstance(v, int):
        return v
    s = str(v).strip()
    if not s:
        return None
    m = re.search(r"(\d+)", s)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def get_bus_and_car_options(
    origin: str,
    destination: str,
    date: Optional[str] = None,
) -> List[Dict[str, Any]]:
    """
    Estimate bus and car (self-drive) options between two places (IATA codes or city names).
    Returns [{ "mode": "bus", "cash_cost": int, "time_cost": int (minutes), ... }, { "mode": "car", ... }].
    Uses OpenAI when available; falls back to simple heuristics if not.
    """
    o = (origin or "").strip().upper()
    d = (destination or "").strip().upper()
    if not o or not d or o == d:
        return []

    k = _cache_key(o, d)
    cached = get_json(k)
    if cached and isinstance(cached, list):
        logger.debug("ground [%s]->[%s]: cache hit", o, d)
        return cached

    # Try OpenAI first
    try:
        client = _openai_client()
        system = """You are a travel assistant. Estimate typical BUS and CAR (self-drive) options between two places.
The places can be IATA airport codes (e.g. JFK, BOS) or city names.
Return a JSON object with two keys: "bus" and "car".
For each:
- price_usd: typical one-way price in USD (bus: FlixBus/Greyhound/Megabus-style; car: gas + tolls, or rental+gas for 1 day if much longer).
- duration_minutes: typical duration in minutes.
Use realistic 2024-2025 figures. If the route is not common by bus, use a nearby hub or "N/A" and you may omit bus.
For car, always provide an estimate (driving or rental)."""
        user = (
            f"Estimate bus and car from {o} to {d}. Return JSON: "
            '{"bus": {"price_usd": number, "duration_minutes": number}, "car": {"price_usd": number, "duration_minutes": number}}.'
        )
        # Prefer JSON mode if supported
        try:
            r = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                response_format={"type": "json_object"},
                temperature=0.2,
            )
        except Exception:
            r = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
                temperature=0.2,
            )
        import json
        raw = r.choices[0].message.content
        data = json.loads(raw) if isinstance(raw, str) else raw

        out: List[Dict[str, Any]] = []
        for mode, key in [("bus", "bus"), ("car", "car")]:
            blob = (data or {}).get(key) if isinstance(data, dict) else {}
            if not blob:
                continue
            price = _to_int(blob.get("price_usd") or blob.get("price"))
            dur = _to_int(blob.get("duration_minutes") or blob.get("duration"))
            if price is None and dur is None:
                continue
            if price is None:
                price = 0
            if dur is None:
                dur = 0
            out.append({
                "mode": mode,
                "cash_cost": float(price),
                "time_cost": int(dur),
                "departure_time": None,
                "arrival_time": None,
                "operating_airline": None,
                "points_cost": None,
                "points_program": None,
                "points_surcharge": None,
                "transfer_partners": [],
            })
        if out:
            set_json(k, out, TTL_GROUND)
            logger.info("ground [%s]->[%s]: OpenAI %d options", o, d, len(out))
            return out
    except Exception as e:
        logger.warning("ground [%s]->[%s]: OpenAI failed: %s; using heuristic", o, d, e)

    # Heuristic: assume ~300 miles and ~$40 bus, ~$60 car; 5h bus, 4.5h car (no real distance API)
    # These are placeholder; in production you'd use a distance/route API.
    out = [
        {"mode": "bus", "cash_cost": 40.0, "time_cost": 300, "departure_time": None, "arrival_time": None,
         "operating_airline": None, "points_cost": None, "points_program": None, "points_surcharge": None, "transfer_partners": []},
        {"mode": "car", "cash_cost": 60.0, "time_cost": 270, "departure_time": None, "arrival_time": None,
         "operating_airline": None, "points_cost": None, "points_program": None, "points_surcharge": None, "transfer_partners": []},
    ]
    set_json(k, out, TTL_GROUND)
    return out


def ground_options_to_edges(origin: str, destination: str, options: List[Dict[str, Any]]) -> Dict[tuple, Dict[str, Any]]:
    """
    Convert get_bus_and_car_options output into the same edge format as flights:
    (origin, dest, "BUS") and (origin, dest, "CAR") with cash_cost, time_cost, points_*=None, etc.
    """
    edges = {}
    for o in options:
        mode = (o.get("mode") or "").upper()
        if mode not in ("BUS", "CAR"):
            continue
        key = (origin.upper(), destination.upper(), mode)
        edges[key] = {
            "cash_cost": o.get("cash_cost"),
            "time_cost": o.get("time_cost"),
            "points_cost": None,
            "points_program": None,
            "points_surcharge": None,
            "transfer_partners": [],
            "departure_time": o.get("departure_time"),
            "arrival_time": o.get("arrival_time"),
            "operating_airline": None,
            "mode": o.get("mode", mode).lower(),
        }
    return edges
