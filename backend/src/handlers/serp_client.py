# backend/serp_client.py
import hashlib
import logging
import os
from itertools import chain
from typing import List, Optional, Dict, Any

import httpx

try:
    from serpapi import GoogleSearch
except ImportError:
    GoogleSearch = None

logger = logging.getLogger(__name__)

# TTL for cached SerpAPI organic results (6h) so benefits stay reasonably up to date
SERP_ORGANIC_CACHE_TTL = 6 * 3600
SERP_ORGANIC_TIMEOUT = httpx.Timeout(connect=5.0, read=20.0)

# TTL for cached Google Flights results (90m, same as flights.serp_route)
SERP_FLIGHTS_CACHE_TTL = 90 * 60
SERP_FLIGHTS_TIMEOUT = httpx.Timeout(connect=5.0, read=25.0)


def _serp_api_key() -> Optional[str]:
    return os.getenv("SERPAPI_KEY") or os.getenv("SERP_API_KEY")


def organic_search(q: str, num: int = 8) -> List[Dict[str, str]]:
    """
    Google organic search via SerpAPI. Returns list of {title, snippet, link} from
    organic_results. Used to fetch up-to-date card benefit snippets for OpenAI extraction.
    Results are cached 6h by query. Requires SERPAPI_KEY or SERP_API_KEY.
    """
    api_key = _serp_api_key()
    if not api_key:
        logger.debug("organic_search: SERPAPI_KEY/SERP_API_KEY not set")
        return []
    try:
        from src.utils.cache_layer import get_json, set_json

        cache_key = "serp:organic:" + hashlib.sha256(q.encode("utf-8")).hexdigest()[:24]
        cached = get_json(cache_key)
        if cached is not None and isinstance(cached, list):
            return cached[:num]
    except Exception:
        pass

    params = {
        "engine": "google",
        "q": q,
        "api_key": api_key,
        "num": min(num, 10),
    }
    try:
        r = httpx.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=SERP_ORGANIC_TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning("organic_search SerpAPI request failed for q=%s: %s", q[:60], e)
        return []

    organic = body.get("organic_results") or []
    out = []
    for o in organic[:num]:
        title = (o.get("title") or "").strip()
        snippet = (o.get("snippet") or "").strip()
        link = (o.get("link") or "").strip()
        if title or snippet:
            out.append({"title": title, "snippet": snippet, "link": link})

    try:
        from src.utils.cache_layer import set_json as _set

        _set(cache_key, out, SERP_ORGANIC_CACHE_TTL)
    except Exception:
        pass
    return out


def search(params: Dict[str, Any]) -> Dict[str, Any]:
    if GoogleSearch is None:
        raise ImportError("serpapi package is not installed. Install it with: pip install google-search-results")
    return GoogleSearch(params).get_dict()


def collect_items(res: dict) -> List[dict]:
    return list(
        chain(res.get("best_flights", []) or [], res.get("other_flights", []) or [])
    )


def pick_cheapest(items: List[dict]) -> Optional[dict]:
    if not items:
        return None
    priced = [it for it in items if isinstance(it.get("price"), (int, float))]
    return min(priced, key=lambda it: it["price"]) if priced else items[0]


def get_flights_between_airports(
    origin: str,
    destination: str,
    date: str,
    *,
    travel_class: Optional[int] = None,
    currency: str = "USD",
    trip_type: int = 2,
    deep_search: bool = True,
) -> List[Dict[str, Any]]:
    """
    Return a list of all flight options between two airports on a given date
    using the SerpAPI Google Flights engine.

    Each item in the list is a flight option (direct or multi-leg) with:
      - price: total price in the given currency
      - flights: list of legs, each with departure_airport, arrival_airport,
        flight_number, duration, etc.
      - total_duration: total trip duration (when present)
      - extensions: any extra data from SerpAPI (e.g. carbon, amenities)

    Args:
        origin: IATA airport code (e.g. JFK, CDG).
        destination: IATA airport code.
        date: Outbound date YYYY-MM-DD.
        travel_class: 1=Economy, 2=Premium economy, 3=Business, 4=First; None = default.
        currency: Currency code for prices (default USD).
        trip_type: SerpAPI type: 1=Round trip (requires return_date), 2=One way (default).
          Use 2 for single-segment fetches when only outbound_date is provided.
        deep_search: If True, SerpAPI may return more options (default True).

    Returns:
        List of flight option dicts (best_flights + other_flights). Empty list if
        API key is missing, request fails, or no results.
    """
    api_key = _serp_api_key()
    if not api_key:
        logger.debug("get_flights_between_airports: SERPAPI_KEY/SERP_API_KEY not set")
        return []

    params: Dict[str, Any] = {
        "engine": "google_flights",
        "api_key": api_key,
        "departure_id": (origin or "").strip().upper(),
        "arrival_id": (destination or "").strip().upper(),
        "outbound_date": (date or "").strip(),
        "type": 1 if trip_type not in (1, 2) else trip_type,
        "currency": (currency or "USD").upper(),
        "deep_search": deep_search,
    }
    if travel_class is not None and travel_class in (1, 2, 3, 4):
        params["travel_class"] = travel_class

    cache_key = "serp:flights:" + hashlib.sha256(
        f"{params['departure_id']}:{params['arrival_id']}:{params['outbound_date']}:{params.get('travel_class', '')}:{params['type']}:{params['currency']}".encode()
    ).hexdigest()[:32]
    try:
        from src.utils.cache_layer import get_json, set_json
        cached = get_json(cache_key)
        if cached is not None and isinstance(cached, list):
            return cached
    except Exception:
        pass

    try:
        r = httpx.get(
            "https://serpapi.com/search.json",
            params=params,
            timeout=SERP_FLIGHTS_TIMEOUT,
        )
        r.raise_for_status()
        body = r.json()
    except Exception as e:
        logger.warning(
            "get_flights_between_airports SerpAPI request failed [%s]->[%s] date=%s: %s",
            params["departure_id"], params["arrival_id"], params["outbound_date"], e,
        )
        return []

    out = collect_items(body)
    try:
        from src.utils.cache_layer import set_json
        set_json(cache_key, out, SERP_FLIGHTS_CACHE_TTL)
    except Exception:
        pass
    return out
