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
