# AwardTool Hotel API - award and cash hotel search
# API docs: https://documenter.getpostman.com/view/31698313/2sB2iwGF3n
# Supports: Hilton (HH), IHG (IHG), Marriott (MAR/Bonvoy), Hyatt (HYATT)

import asyncio
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from dotenv import load_dotenv

from src.utils.cache_layer import get_json, set_json

load_dotenv()

logger = logging.getLogger(__name__)

# Support both naming conventions (AWARD_TOOL vs AWARDTOOL, per apprunner)
AWARD_TOOL_API_KEY = os.getenv("AWARD_TOOL_API_KEY") or os.getenv("AWARDTOOL_API_KEY")
HOTEL_SEARCH_URL = "https://www.awardtool-api.com/search_hotel"

# Default hotel programs if none provided (AwardTool: Hilton, IHG, Marriott, Hyatt)
DEFAULT_HOTEL_PROGRAMS = ["HH", "IHG", "MAR", "HYATT"]

TIMEOUT = httpx.Timeout(connect=5.0, read=25.0, write=5.0, pool=20)


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
